// Photos on a trip, from Immich albums shared by link (2026-11-18).
//
// A trip member pastes an Immich album's shared link; Splitty keeps the link's
// key on a PhotoAlbum node and reads the album through it: the photos' times
// and places, and their thumbnails, which the Splitty server passes through so
// members never talk to Immich themselves. The key gives access to that album
// only (Immich enforces it) and is never sent to the browser. Revoking the
// link in Immich cuts Splitty off.
//
//   (:PhotoAlbum {id, immichAlbumId, name, shareKey | shareSlug, addedOn})
//       -[:PHOTOS_OF]->(:Trip), -[:ADDED_BY]->(:User)
//
// For now only links to Jonas's own Immich are accepted (IMMICH_PUBLIC_URL,
// the address in the link; IMMICH_URL, where this server reaches it). Other
// people's servers would need the address checks this deliberately avoids.

const driver = require('./neo4j');

const INTERNAL = (process.env.IMMICH_URL || '').replace(/\/+$/, '');
const PUBLIC_ORIGIN = (() => {
    try { return new URL(process.env.IMMICH_PUBLIC_URL).origin; } catch { return null; }
})();
const enabled = () => Boolean(INTERNAL && PUBLIC_ORIGIN);

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_PHOTOS = 3000;      // per album
const MAX_BUCKETS = 60;       // months per album
const MAX_ALBUMS = 10;        // per trip
const TRIP_ACCESS = '(:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:PLANNED_IN]-(t:Trip {id: $tripId})';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PhotoError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

// The key (or slug) in a shared link of our Immich, or a PhotoError.
function parseShareLink(input) {
    let url;
    try { url = new URL(String(input || '').trim()); } catch { throw new PhotoError('That is not a link.'); }
    if (url.origin !== PUBLIC_ORIGIN) throw new PhotoError(`Only shared links from ${PUBLIC_ORIGIN.replace(/^https?:\/\//, '')} work for now.`);
    const m = url.pathname.match(/^\/(share|s)\/([A-Za-z0-9_-]{1,200})\/?$/);
    if (!m) throw new PhotoError('That is not a shared album link. In Immich: open the album › Share › Create link, and paste that.');
    return m[1] === 'share' ? { shareKey: m[2] } : { shareSlug: m[2] };
}

const authQuery = a => (a.shareKey ? { key: a.shareKey } : { slug: a.shareSlug });

async function immich(path, auth, params = {}, { raw = false } = {}) {
    const qs = new URLSearchParams({ ...params, ...authQuery(auth) });
    let res;
    try {
        res = await fetch(`${INTERNAL}/api${path}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: raw ? 'image/*' : 'application/json' } });
    } catch {
        throw new PhotoError('Immich could not be reached.', 502);
    }
    if (res.status === 401 || res.status === 403) throw new PhotoError('Immich refused the link: it may have been removed, expired, or have a password (not supported).', 410);
    if (res.status === 404) throw new PhotoError('Not found in Immich.', 404);
    if (!res.ok) throw new PhotoError(`Immich answered ${res.status}.`, 502);
    return raw ? res : res.json();
}

// What a shared link points at: { immichAlbumId, name }; only album links.
async function describeLink(auth) {
    const link = await immich('/shared-links/me', auth);
    if (link.type !== 'ALBUM' || !link.album?.id) throw new PhotoError('That link shares single photos, not an album. Share the album itself.');
    return { immichAlbumId: link.album.id, name: (link.album.albumName || 'Album').slice(0, 120) };
}

// Wall-clock time where the photo was taken ('YYYY-MM-DDTHH:mm'), like trip
// times: Immich gives UTC plus the offset of the place.
const localMoment = (utc, offsetHours) => {
    const t = Date.parse(utc);
    if (Number.isNaN(t)) return null;
    return new Date(t + (Number(offsetHours) || 0) * 3600_000).toISOString().slice(0, 16);
};

async function fetchPhotos(album) {
    const auth = album;
    const params = { albumId: album.immichAlbumId, order: 'asc' };
    const buckets = (await immich('/timeline/buckets', auth, params)).slice(0, MAX_BUCKETS);
    const photos = [];
    for (const b of buckets) {
        const col = await immich('/timeline/bucket', auth, { ...params, timeBucket: b.timeBucket, withCoordinates: 'true' });
        for (let i = 0; i < (col.id || []).length && photos.length < MAX_PHOTOS; i++) {
            if (col.isTrashed?.[i]) continue;
            const lat = col.latitude?.[i], lon = col.longitude?.[i];
            photos.push({
                id: col.id[i],
                at: localMoment(col.fileCreatedAt?.[i], col.localOffsetHours?.[i]),
                lat: Number.isFinite(lat) ? lat : null,
                lon: Number.isFinite(lon) ? lon : null,
                ratio: Number(col.ratio?.[i]) || 1,
                video: col.isImage ? !col.isImage[i] : false,
            });
        }
    }
    return photos;
}

const cache = new Map(); // album node id -> { at, photos } | { at, error }
async function photosOf(album) {
    const hit = cache.get(album.id);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        if (hit.error) throw hit.error;
        return hit.photos;
    }
    try {
        const photos = await fetchPhotos(album);
        cache.set(album.id, { at: Date.now(), photos });
        return photos;
    } catch (err) {
        // A broken link is remembered for a minute, not retried on every load.
        cache.set(album.id, { at: Date.now() - CACHE_TTL_MS + 60_000, error: err });
        throw err;
    }
}

const albumProps = r => {
    const a = r.get('a').properties;
    return { id: a.id, immichAlbumId: a.immichAlbumId, name: a.name, shareKey: a.shareKey, shareSlug: a.shareSlug, addedBy: r.get('addedBy') };
};

async function albumsOfTrip(tripId, userId) {
    const { records } = await driver.executeQuery(
        `MATCH ${TRIP_ACCESS}
         OPTIONAL MATCH (a:PhotoAlbum)-[:PHOTOS_OF]->(t)
         OPTIONAL MATCH (a)-[:ADDED_BY]->(u:User)
         RETURN t.id AS tripId, a, u.name AS addedBy ORDER BY a.addedOn`,
        { tripId, userId }
    );
    if (records.length === 0) return null; // no access
    return records.filter(r => r.get('a')).map(albumProps);
}

// The trip's albums and their photos, for a member. Null without access.
async function tripPhotos(tripId, userId) {
    const albums = await albumsOfTrip(tripId, userId);
    if (!albums) return null;
    const out = { albums: [], photos: [] };
    for (const a of albums) {
        try {
            const photos = await photosOf(a);
            out.albums.push({ id: a.id, name: a.name, addedBy: a.addedBy, count: photos.length });
            for (const p of photos) out.photos.push({ ...p, album: a.id });
        } catch (err) {
            out.albums.push({ id: a.id, name: a.name, addedBy: a.addedBy, count: 0, error: err.message });
        }
    }
    out.photos.sort((x, y) => (x.at || '').localeCompare(y.at || ''));
    return out;
}

async function addAlbum(tripId, userId, link) {
    const auth = parseShareLink(link);
    const albums = await albumsOfTrip(tripId, userId);
    if (!albums) throw new PhotoError('Trip not found', 404);
    if (albums.length >= MAX_ALBUMS) throw new PhotoError(`A trip can have at most ${MAX_ALBUMS} albums.`);
    const { immichAlbumId, name } = await describeLink(auth);
    if (albums.some(a => a.immichAlbumId === immichAlbumId)) throw new PhotoError('That album is already on this trip.', 409);
    const { records } = await driver.executeQuery(
        `MATCH ${TRIP_ACCESS}
         MATCH (u:User {id: $userId})
         CREATE (a:PhotoAlbum {id: randomUUID(), immichAlbumId: $immichAlbumId, name: $name, addedOn: datetime()})-[:PHOTOS_OF]->(t)
         CREATE (a)-[:ADDED_BY]->(u)
         SET a.shareKey = $shareKey, a.shareSlug = $shareSlug
         RETURN a.id AS id`,
        { tripId, userId, immichAlbumId, name, shareKey: auth.shareKey ?? null, shareSlug: auth.shareSlug ?? null }
    );
    return { id: records[0].get('id'), name };
}

async function removeAlbum(tripId, userId, albumId) {
    const { records } = await driver.executeQuery(
        `MATCH ${TRIP_ACCESS}
         MATCH (a:PhotoAlbum {id: $albumId})-[:PHOTOS_OF]->(t)
         DETACH DELETE a
         RETURN 1 AS ok`,
        { tripId, userId, albumId }
    );
    cache.delete(albumId);
    return records.length > 0;
}

// For the signed thumbnail route: the album's link, no member check (the
// signature is the proof). Null when the album is gone.
async function albumForThumbnail(albumId) {
    const { records } = await driver.executeQuery(
        `MATCH (a:PhotoAlbum {id: $albumId}) OPTIONAL MATCH (a)-[:ADDED_BY]->(u:User) RETURN a, u.name AS addedBy`,
        { albumId }
    );
    return records.length ? albumProps(records[0]) : null;
}

// Immich's image response for one photo of the album (size thumbnail|preview).
// Immich checks the photo is in the album the key is for.
async function thumbnail(album, assetId, size) {
    if (!UUID.test(assetId)) throw new PhotoError('Not found', 404);
    return immich(`/assets/${assetId}/thumbnail`, album, { size }, { raw: true });
}

// For the public follow page (followService.js), which has checked its link
// itself: the trip's albums without a member check.
async function albumsOfTripUnchecked(tripId) {
    const { records } = await driver.executeQuery(
        `MATCH (a:PhotoAlbum)-[:PHOTOS_OF]->(:Trip {id: $tripId}) OPTIONAL MATCH (a)-[:ADDED_BY]->(u:User)
         RETURN a, u.name AS addedBy ORDER BY a.addedOn`,
        { tripId }
    );
    return records.map(albumProps);
}

module.exports = { enabled, PhotoError, tripPhotos, addAlbum, removeAlbum, albumForThumbnail, thumbnail, albumsOfTripUnchecked, photosOf };
