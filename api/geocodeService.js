// geocodeService.js
//
// Turns a place name or address into coordinates with OpenStreetMap's
// Nominatim. Its usage policy asks for an identifying User-Agent, at most one
// request per second, and no autocomplete — so searches are explicit, queued
// one at a time, and cached.
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;
const CACHE_MAX = 500;

const cache = new Map();
let queue = Promise.resolve();
let lastCall = 0;

const userAgent = () => `Splitty/1.0 (${process.env.APP_URL || 'self-hosted'})`;

async function fetchResults(query) {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastCall = Date.now();

    const url = `${ENDPOINT}?${new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', addressdetails: '0' })}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Geocoder error: ${res.status}`);
    const data = await res.json();
    return data.map(r => ({
        name: r.name || r.display_name.split(',')[0],
        address: r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
    }));
}

async function search(rawQuery) {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    const key = query.toLowerCase();
    if (cache.has(key)) return cache.get(key);

    // Chain onto the queue so concurrent searches still go out one at a time.
    const result = queue.then(() => fetchResults(query));
    queue = result.catch(() => {});
    const places = await result;

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, places);
    return places;
}

module.exports = { search };
