// geocodeService.js
//
// Turns a place name or address into coordinates with OpenStreetMap's
// Nominatim. Its usage policy asks for an identifying User-Agent, at most one
// request per second, and no autocomplete — so searches are explicit, queued
// one at a time, and cached.
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;
const CACHE_MAX = 500;
// Each lookup in the queue is at least another second's wait, so past a few
// a new one fails at once instead of holding its request open.
const MAX_WAITING = 4;

const cache = new Map();
let queue = Promise.resolve();
let lastCall = 0;
let waiting = 0;

const userAgent = () => `Splitty/1.0 (${process.env.APP_URL || 'self-hosted'})`;

async function fetchJson(params) {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastCall = Date.now();

    const url = `${ENDPOINT}?${new URLSearchParams({ format: 'jsonv2', ...params })}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Geocoder error: ${res.status}`);
    return res.json();
}

// Cached, and chained onto the queue so concurrent lookups still go out one
// at a time. A full queue throws an error marked `busy`.
async function throttled(key, load) {
    if (cache.has(key)) return cache.get(key);
    if (waiting >= MAX_WAITING) throw Object.assign(new Error('Geocoder queue is full'), { busy: true });
    waiting++;
    const result = queue.then(() => (cache.has(key) ? cache.get(key) : load()));
    queue = result.catch(() => {});
    let value;
    try {
        value = await result;
    } finally {
        waiting--;
    }

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
}

async function search(rawQuery) {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    return throttled(`search:${query.toLowerCase()}`, async () => {
        const data = await fetchJson({ q: query, limit: '5', addressdetails: '0' });
        return data.map(r => ({
            name: r.name || r.display_name.split(',')[0],
            address: r.display_name,
            lat: Number(r.lat),
            lon: Number(r.lon),
        }));
    });
}

// ── English names for stations ──

// Only these are a station or a stop; a name found on anything else (a shop
// in the station, the street outside) is not the name of the stop.
const STOP_TYPES = {
    railway: ['station', 'halt', 'stop', 'tram_stop'],
    public_transport: ['station', 'stop_position', 'platform', 'stop_area'],
    highway: ['bus_stop'],
    amenity: ['bus_station', 'ferry_terminal'],
    building: ['train_station', 'transportation'],
    aeroway: ['aerodrome', 'terminal'],
};
const NEAR_METRES = 300;

// True when every letter is Latin script ("Ershui", "Bruxelles-Midi"), so a
// reader of the app's English UI can read it.
const isLatin = name => [...name].every(c => !/\p{L}/u.test(c) || /\p{Script=Latin}/u.test(c));

function metresBetween(a, b) {
    const rad = d => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// The English (or at least Latin-script) name of a stop that timetables only
// know as e.g. "二水". Looked up by that name within a few hundred metres,
// rather than by reverse geocoding: at a station's coordinates the nearest
// object is as likely a ticket office or a defibrillator as the station.
// Returns null unless a station or stop of that name is found close by with a
// readable name — a wrong name is worse than the original one.
async function englishStopName(name, lat, lon) {
    if (!name || isLatin(name) || lat == null || lon == null) return null;
    const d = 0.01; // about a kilometre each way: the box to search in
    return throttled(`stop:${name}|${lat.toFixed(4)},${lon.toFixed(4)}`, async () => {
        const data = await fetchJson({
            q: name,
            limit: '5',
            namedetails: '1',
            bounded: '1',
            viewbox: [lon - d, lat + d, lon + d, lat - d].join(','),
        });
        for (const r of data) {
            if (!STOP_TYPES[r.category]?.includes(r.type)) continue;
            if (metresBetween({ lat, lon }, { lat: Number(r.lat), lon: Number(r.lon) }) > NEAR_METRES) continue;
            const english = (r.namedetails?.['name:en'] || r.name || '').trim();
            if (english && isLatin(english) && english.length <= 160) return english;
        }
        return null;
    });
}

module.exports = { search, englishStopName, isLatin, metresBetween };
