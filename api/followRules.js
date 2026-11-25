// What a follow link shows, as pure rules (followService.js uses them; tested
// without a database in tests/follow.test.js).

const PHOTO_MODES = ['all', 'favourites', 'none'];
// Stored as a word; older links have true (all) or false (none).
const photoMode = v => (v === true ? 'all' : PHOTO_MODES.includes(v) ? v : 'none');
const dayOf = m => (m ? String(m).slice(0, 10) : '');

// The photos a link shows, in time order: up to today, all or the starred
// ones. `favourite` itself is not passed on.
function pickPhotos(photos, mode, today) {
    if (mode === 'none') return [];
    return photos
        .filter(p => p.at && dayOf(p.at) <= today && (mode === 'all' || p.favourite))
        .map(({ favourite, ...p }) => p) // eslint-disable-line no-unused-vars
        .sort((a, b) => a.at.localeCompare(b.at));
}

// Great-circle distance in km.
const km = (a, b) => {
    const rad = d => (d * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// "22 days · 9 towns · 3,100 km · 412 photos": days so far (all of them once
// it has ended), the towns slept in, the journeys' straight-line distance
// (from exact places; only the total leaves the server), and the photos.
function summarize({ startDate, endDate, today, items, placeById, towns, photoCount }) {
    const last = endDate && endDate < today ? endDate : today;
    const days = startDate && startDate <= last
        ? Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1
        : 0;
    let distance = 0;
    for (const i of items) {
        if (i.kind !== 'transport') continue;
        const a = placeById.get(i.fromPlaceId), b = placeById.get(i.toPlaceId);
        if (a?.lat != null && b?.lat != null) distance += km(a, b);
    }
    return { days, towns: new Set(towns).size, km: Math.round(distance / 10) * 10, photos: photoCount };
}

module.exports = { PHOTO_MODES, photoMode, pickPhotos, summarize };
