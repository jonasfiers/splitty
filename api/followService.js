// "Follow my trip": a public, read-only view of a trip through a link
// (2026-11-18). No account needed, so everything private is left out here,
// on the server; the page gets nothing it shouldn't show.
//
// What a follower sees, decided with Jonas:
// - Up to today only: past days and today. Later entries, places, photos, the
//   arrival of a journey still under way and the trip's end date (while it is
//   on) are left out, so the link doesn't announce plans or when you're home.
//   "Today" is the earliest date in any of the trip's time zones, so it never
//   runs ahead.
// - Stays by town only: "Stay in Hualien", a pin near the town's middle, no
//   hotel name or address. A place a stay uses is treated the same where a
//   journey starts or ends there too.
// - Titles, times and places of the rest; never booking references, notes,
//   links, files, documents, flight numbers, money or who else is going.
// - The sharer's first name ("Follow Jonas's trip").
// - Photos of the trip's linked Immich albums, up to today, if the link has
//   them switched on.
//
//   (:FollowLink {token, photos, createdOn})-[:FOLLOWS]->(:Trip), -[:CREATED_BY]->(:User)
//
// A link works until it is removed, or 30 days after the trip ends.

const crypto = require('crypto');
const driver = require('./neo4j');
const tripPhotos = require('./tripPhotos');
const { townAt } = require('./geocodeService');
const { zoneAt } = require('./timeZone');
const { categoryServiceNeo4j } = require('./crudService');

const EXPIRES_AFTER_DAYS = 30;
const MAX_LINKS = 5; // per trip
const KIND_LABELS = { Transport: 'transport', Stay: 'stay', Activity: 'activity' };
const TRIP_ACCESS = '(:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:PLANNED_IN]-(t:Trip {id: $tripId})';
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

const dayOf = m => (m ? String(m).slice(0, 10) : '');
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayIn = zone => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'Someone';

// ── Managing links (trip members) ──

async function listLinks(tripId, userId) {
    const { records } = await driver.executeQuery(
        `MATCH ${TRIP_ACCESS}
         OPTIONAL MATCH (l:FollowLink)-[:FOLLOWS]->(t)
         OPTIONAL MATCH (l)-[:CREATED_BY]->(u:User)
         RETURN t.id AS tripId, l, u.name AS by ORDER BY l.createdOn`,
        { tripId, userId }
    );
    if (records.length === 0) return null;
    return records.filter(r => r.get('l')).map(r => {
        const l = r.get('l').properties;
        return { token: l.token, photos: !!l.photos, createdOn: l.createdOn?.toString(), by: r.get('by') };
    });
}

async function createLink(tripId, userId, { photos = true } = {}) {
    const links = await listLinks(tripId, userId);
    if (!links) return null;
    if (links.length >= MAX_LINKS) throw Object.assign(new Error(`A trip can have at most ${MAX_LINKS} follow links.`), { status: 400 });
    const token = crypto.randomBytes(18).toString('base64url'); // 144 bits
    await driver.executeQuery(
        `MATCH ${TRIP_ACCESS}
         MATCH (u:User {id: $userId})
         CREATE (l:FollowLink {token: $token, photos: $photos, createdOn: datetime()})-[:FOLLOWS]->(t)
         CREATE (l)-[:CREATED_BY]->(u)`,
        { tripId, userId, token, photos: !!photos }
    );
    return { token, photos: !!photos };
}

async function removeLink(tripId, userId, token) {
    const { records } = await driver.executeQuery(
        `MATCH ${TRIP_ACCESS}
         MATCH (l:FollowLink {token: $token})-[:FOLLOWS]->(t)
         DETACH DELETE l RETURN 1 AS ok`,
        { tripId, userId, token }
    );
    views.delete(token);
    return records.length > 0;
}

// ── The public view ──

// The link's trip if it still works: { tripId, photos, sharer, trip } or null.
async function resolve(token) {
    if (!TOKEN.test(String(token || ''))) return null;
    const { records } = await driver.executeQuery(
        `MATCH (l:FollowLink {token: $token})-[:FOLLOWS]->(t:Trip)
         OPTIONAL MATCH (l)-[:CREATED_BY]->(u:User)
         RETURN t, l.photos AS photos, u.name AS by`,
        { token }
    );
    if (!records.length) return null;
    const t = records[0].get('t').properties;
    if (t.endDate && addDays(t.endDate, EXPIRES_AFTER_DAYS) < todayIn('UTC')) return null;
    return { tripId: t.id, trip: t, photos: !!records[0].get('photos'), sharer: firstName(records[0].get('by')) };
}

async function loadPlan(tripId) {
    const { records: itemRecords } = await driver.executeQuery(
        `MATCH (i:TripItem)-[:PART_OF]->(:Trip {id: $tripId})
         OPTIONAL MATCH (i)-[:AT]->(p:Place)
         OPTIONAL MATCH (i)-[:DEPARTS_FROM]->(f:Place)
         OPTIONAL MATCH (i)-[:ARRIVES_AT]->(a:Place)
         RETURN i.id AS id, i.title AS title, i.start AS start, i.end AS end, i.mode AS mode, labels(i) AS labels,
                p.id AS placeId, f.id AS fromPlaceId, a.id AS toPlaceId
         ORDER BY i.start, i.title`,
        { tripId }
    );
    const { records: placeRecords } = await driver.executeQuery(
        'MATCH (p:Place)-[:PLACE_OF]->(:Trip {id: $tripId}) RETURN p',
        { tripId }
    );
    const items = itemRecords.map(r => ({
        id: r.get('id'), title: r.get('title'), start: r.get('start'), end: r.get('end'), mode: r.get('mode'),
        kind: KIND_LABELS[r.get('labels').find(l => KIND_LABELS[l])] ?? 'activity',
        placeId: r.get('placeId'), fromPlaceId: r.get('fromPlaceId'), toPlaceId: r.get('toPlaceId'),
    }));
    const places = placeRecords.map(r => r.get('p').properties);
    return { items, places };
}

// The town of a private place, remembered on the Place node (Nominatim allows
// one lookup a second; a popular link must not repeat them).
async function townOf(place) {
    if (place.lat == null || place.lon == null) return null;
    const at = `${place.lat},${place.lon}`;
    if (place.townAt === at) return place.town ?? null;
    try {
        const town = await townAt(place.lat, place.lon);
        await driver.executeQuery('MATCH (p:Place {id: $id}) SET p.town = $town, p.townAt = $at', { id: place.id, town, at });
        return town;
    } catch {
        return null; // busy or down: no town this time
    }
}

// A pin near the town rather than the building: rounded to ~2 km.
const blur = v => (v == null ? null : Math.round(v * 50) / 50);

// Each view is kept for a minute: a page loads dozens of thumbnails, each
// checked against it (photoAllowed). Removing a link clears it at once.
const VIEW_TTL_MS = 60_000;
const views = new Map(); // token -> { at, view }

async function publicView(token) {
    const hit = views.get(token);
    if (hit && Date.now() - hit.at < VIEW_TTL_MS) return hit.view;
    const view = await buildView(token);
    if (views.size > 500) views.delete(views.keys().next().value);
    views.set(token, { at: Date.now(), view });
    return view;
}

async function buildView(token) {
    const link = await resolve(token);
    if (!link) return null;
    const { trip } = link;
    const { items, places } = await loadPlan(link.tripId);

    const zones = [...new Set(places.map(p => zoneAt(p.lat ?? null, p.lon ?? null)).filter(Boolean))];
    const today = (zones.length ? zones : ['Europe/Brussels']).map(todayIn).sort()[0];
    const started = trip.startDate <= today;

    // Up to today: what has started by the end of today.
    const shownItems = started ? items.filter(i => dayOf(i.start) && dayOf(i.start) <= today) : [];
    const stayPlaceIds = new Set(items.filter(i => i.kind === 'stay' && i.placeId).map(i => i.placeId));
    const placeById = new Map(places.map(p => [p.id, p]));

    const outItems = [];
    for (const i of shownItems) {
        const ends = dayOf(i.end);
        const item = { id: i.id, kind: i.kind, mode: i.kind === 'transport' ? i.mode : null, title: i.title, start: i.start, end: i.end,
            placeId: i.placeId, fromPlaceId: i.fromPlaceId, toPlaceId: i.toPlaceId };
        if (ends && ends > today) {
            // Still under way: a stay goes on past tonight (its check-out day
            // is not given away); a journey's arrival is left out.
            if (i.kind === 'stay') item.end = addDays(today, 1);
            else { item.end = null; item.toPlaceId = null; }
        }
        if (i.kind === 'stay') {
            const town = await townOf(placeById.get(i.placeId) ?? {});
            item.title = town ? `Stay in ${town}` : 'Stay';
        }
        outItems.push(item);
    }

    const usedPlaceIds = new Set(outItems.flatMap(i => [i.placeId, i.fromPlaceId, i.toPlaceId]).filter(Boolean));
    const outPlaces = [];
    for (const id of usedPlaceIds) {
        const p = placeById.get(id);
        if (!p) continue;
        if (stayPlaceIds.has(id)) {
            const town = await townOf(p);
            outPlaces.push({ id, name: town || 'Stay', lat: blur(p.lat), lon: blur(p.lon), approximate: true });
        } else {
            outPlaces.push({ id, name: p.name, lat: p.lat ?? null, lon: p.lon ?? null });
        }
    }

    let photos = [];
    if (link.photos && started && tripPhotos.enabled()) {
        for (const album of await tripPhotos.albumsOfTripUnchecked(link.tripId)) {
            try {
                for (const p of await tripPhotos.photosOf(album)) {
                    if (p.at && dayOf(p.at) <= today) photos.push({ ...p, album: album.id });
                }
            } catch { /* a broken album just has no photos here */ }
        }
        photos.sort((a, b) => a.at.localeCompare(b.at));
    }

    let kindColours = {};
    try { kindColours = await categoryServiceNeo4j.getTripKinds(); } catch { /* fallback colours */ }

    return {
        token,
        sharer: link.sharer,
        today,
        started,
        trip: {
            title: trip.title,
            icon: trip.icon || '',
            startDate: started ? trip.startDate : null,
            // The end only once it has passed: while on, it says when you're home.
            endDate: trip.endDate && trip.endDate <= today ? trip.endDate : null,
        },
        items: outItems,
        places: outPlaces,
        photos,
        kinds: kindColours,
    };
}

// For the public photo route: is this photo one the link shows? Returns the
// album (with its key, for the server's request to Immich) or null.
async function photoAllowed(token, albumId, assetId) {
    const view = await publicView(token);
    if (!view) return null;
    if (!view.photos.some(p => p.album === albumId && p.id === assetId)) return null;
    return tripPhotos.albumForThumbnail(albumId);
}

module.exports = { listLinks, createLink, removeLink, publicView, photoAllowed };
