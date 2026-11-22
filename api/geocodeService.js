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

async function fetchJson(params, endpoint = ENDPOINT) {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastCall = Date.now();

    const url = `${endpoint}?${new URLSearchParams({ format: 'jsonv2', ...params })}`;
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

// Nominatim's search: only for a search asked for explicitly (Enter), when
// Photon is not answering.
async function searchNominatim(query) {
    return throttled(`search:${query.toLowerCase()}`, async () => {
        const data = await fetchJson({ q: query, limit: '5', addressdetails: '0' });
        return data.map(r => ({
            name: r.name || r.display_name.split(',')[0],
            address: r.display_name,
            area: '',
            type: 'place',
            label: '',
            lat: Number(r.lat),
            lon: Number(r.lon),
        }));
    });
}

// ── Place search as you type: Photon ──
//
// Komoot's public Photon (OpenStreetMap data, as Nominatim) is made for
// search-as-you-type: partial words, results near a point first. Its terms ask
// for fair use and promise nothing, so it has its own small queue and cache,
// and Nominatim stays as the fallback for explicit searches.
const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_INTERVAL_MS = 200;
const PHOTON_MAX_WAITING = 6;
const PHOTON_ZOOM = 9; // how far "near" reaches: about a region
let photonQueue = Promise.resolve();
let photonLast = 0;
let photonWaiting = 0;

// What kind of place an OpenStreetMap object is, as the picker shows it:
// a `type` the app picks an icon by, and a label. Unknown kinds are a plain
// place labelled by their tag ("Museum", "Viewpoint").
const KINDS = [
    [['railway', 'station'], 'station', 'Station'], [['railway', 'halt'], 'station', 'Station'],
    [['building', 'train_station'], 'station', 'Station'], [['public_transport', 'station'], 'station', 'Station'],
    [['building', 'transportation'], 'station', 'Station'],
    [['railway', 'stop'], 'station', 'Platform'], [['railway', 'tram_stop'], 'tram', 'Tram stop'],
    [['railway', 'subway_entrance'], 'station', 'Metro entrance'],
    [['highway', 'bus_stop'], 'bus', 'Bus stop'], [['amenity', 'bus_station'], 'bus', 'Bus station'],
    [['public_transport', 'stop_position'], 'bus', 'Stop'], [['public_transport', 'platform'], 'bus', 'Stop'],
    [['aeroway', 'aerodrome'], 'airport', 'Airport'], [['aeroway', 'terminal'], 'airport', 'Airport terminal'],
    [['amenity', 'ferry_terminal'], 'ferry', 'Ferry terminal'],
    [['tourism', 'hotel'], 'stay', 'Hotel'], [['tourism', 'hostel'], 'stay', 'Hostel'],
    [['tourism', 'guest_house'], 'stay', 'Guest house'], [['tourism', 'motel'], 'stay', 'Motel'],
    [['tourism', 'apartment'], 'stay', 'Apartment'], [['tourism', 'camp_site'], 'camp', 'Campsite'],
    [['amenity', 'restaurant'], 'food', 'Restaurant'], [['amenity', 'cafe'], 'cafe', 'Café'],
    [['natural', 'water'], 'water', 'Water'], [['water', 'lake'], 'water', 'Lake'], [['water', 'reservoir'], 'water', 'Lake'],
    [['landuse', 'reservoir'], 'water', 'Lake'], [['natural', 'beach'], 'beach', 'Beach'],
    [['natural', 'peak'], 'mountain', 'Mountain'], [['natural', 'volcano'], 'mountain', 'Volcano'],
    [['place', 'city'], 'town', 'City'], [['place', 'town'], 'town', 'Town'], [['place', 'village'], 'town', 'Village'],
    [['place', 'hamlet'], 'town', 'Village'], [['place', 'suburb'], 'town', 'District'],
    [['place', 'neighbourhood'], 'town', 'Neighbourhood'], [['place', 'quarter'], 'town', 'District'],
    [['place', 'county'], 'area', 'Region'], [['place', 'state'], 'area', 'Region'], [['place', 'country'], 'area', 'Country'],
    [['place', 'house'], 'address', 'Address'], [['building', 'house'], 'address', 'Address'],
    [['building', 'residential'], 'address', 'Address'], [['building', 'apartments'], 'address', 'Address'],
];
const TRANSIT_TYPES = new Set(['station', 'tram', 'bus', 'airport', 'ferry']);
const humanise = v => (v && v !== 'yes' ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') : '');

function kindOf(key, value, objectType) {
    const hit = KINDS.find(([[k, v]]) => k === key && v === value);
    if (hit) return { type: hit[1], label: hit[2] };
    if (key === 'highway') return { type: 'street', label: objectType === 'street' ? 'Street' : humanise(value) };
    if (key === 'building' && value === 'yes') return { type: 'address', label: 'Address' };
    if (key === 'boundary') return { type: 'area', label: 'Area' };
    return { type: 'place', label: humanise(value) };
}

const unique = parts => parts.filter((p, i) => p && parts.indexOf(p) === i);
// Without parts only in a local script ("台灣省") when English ones are left,
// as the app is in English; all of them when nothing else is.
const readable = parts => (parts.some(isLatin) ? parts.filter(isLatin) : parts);

// A Photon feature as the picker shows it and a place stores it.
function fromPhoton(feature) {
    const p = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    const { type, label } = kindOf(p.osm_key, p.osm_value, p.type);
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const town = [p.city, p.town, p.village, p.district, p.county].find(t => t && isLatin(t))
        || p.city || p.town || p.village || p.district || p.county || '';
    const name = p.name || street || town || p.state || p.country || '';
    // "Taipei, Taiwan": where it is, without the place's own name.
    const area = readable(unique([town, p.country]).filter(x => x !== name)).join(', ');
    const address = readable(unique([street !== name && street, [p.postcode, town].filter(Boolean).join(' '), p.state, p.country])
        .filter(x => x && x !== name)).join(', ');
    return { name, address, area, type, label, lat: Number(lat), lon: Number(lon) };
}

// One place is often mapped several times: a station, its building and each
// platform (the same name within a kilometre: big stations are big), or a
// street or path in pieces (the same name in the same town). Shown once.
function dedupe(results) {
    const kept = [];
    const transit = r => TRANSIT_TYPES.has(r.type);
    for (const r of results) {
        const same = kept.some(k => {
            if (k.name.toLowerCase() !== r.name.toLowerCase()) return false;
            if (transit(k) && transit(r)) return metresBetween(k, r) < 1000;
            if (k.type !== r.type) return false;
            return k.type === 'street' ? k.area === r.area : metresBetween(k, r) < 400;
        });
        if (!same) kept.push(r);
    }
    return kept;
}

async function searchPhoton(query, near) {
    const nearKey = near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : '';
    const key = `photon:${query.toLowerCase()}|${nearKey}`;
    if (cache.has(key)) return cache.get(key);
    if (photonWaiting >= PHOTON_MAX_WAITING) throw Object.assign(new Error('Photon queue is full'), { busy: true });
    photonWaiting++;
    const load = async () => {
        const wait = photonLast + PHOTON_INTERVAL_MS - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        photonLast = Date.now();
        const params = { q: query, limit: '12', lang: 'en' };
        if (near) Object.assign(params, { lat: String(near.lat), lon: String(near.lon), zoom: String(PHOTON_ZOOM) });
        const res = await fetch(`${PHOTON}?${new URLSearchParams(params)}`, {
            headers: { 'User-Agent': userAgent() },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Photon error: ${res.status}`);
        const data = await res.json();
        return dedupe((data.features || []).map(fromPhoton).filter(r => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon)));
    };
    const result = photonQueue.then(load);
    photonQueue = result.catch(() => {});
    let value;
    try {
        value = await result;
    } finally {
        photonWaiting--;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
}

// Places matching `rawQuery`, best first, at most 8. `near` ({lat, lon}, the
// trip's area) ranks places close to it higher without hiding the rest;
// `transit` puts stations and stops first (the route finder). `typing` marks
// a search sent while typing: those never fall back to Nominatim, whose
// policy forbids autocomplete; they fail instead, and Enter searches it.
async function search(rawQuery, { near = null, transit = false, typing = false } = {}) {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    let results;
    try {
        results = await searchPhoton(query, near);
    } catch (error) {
        if (typing) throw error;
        console.warn(`Photon failed, falling back to Nominatim: ${error.message}`);
        results = await searchNominatim(query);
    }
    if (transit) results = [...results].sort((a, b) => TRANSIT_TYPES.has(b.type) - TRANSIT_TYPES.has(a.type));
    return results.slice(0, 8);
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
// Whether an OpenStreetMap name is the timetable's name: equal, or one
// containing the other ("臺北" / "臺北車站"), with 臺 and 台 (both used for
// "Tai") treated as the same.
const normName = v => String(v || '').replace(/臺/g, '台').replace(/[\s()（）]/g, '').toLowerCase();
const sameName = (original, exact) => {
    const a = normName(original);
    return v => { const b = normName(v); return Boolean(a && b && (a === b || (!exact && ((a.length >= 2 && b.includes(a)) || (b.length >= 2 && a.includes(b)))))); };
};

async function englishStopName(name, lat, lon) {
    if (!name || isLatin(name) || lat == null || lon == null) return null;
    const d = 0.01; // about a kilometre each way: the box to search in
    return throttled(`stop3:${name}|${lat.toFixed(4)},${lon.toFixed(4)}`, async () => {
        const data = await fetchJson({
            q: name,
            limit: '5',
            namedetails: '1',
            bounded: '1',
            viewbox: [lon - d, lat + d, lon + d, lat - d].join(','),
        });
        // A stop's current name before its old or alternative ones (a bus stop
        // renamed "北平林森路口" keeps "捷運善導寺站" as old_name, while the real
        // 捷運善導寺站 stops are a few metres on), and exact before partial.
        const current = nd => Object.entries(nd || {}).filter(([k]) => k === 'name' || k === 'official_name' || k.startsWith('name:')).map(([, v]) => v);
        const any = nd => Object.values(nd || {});
        for (const [exact, namesOf] of [[true, current], [true, any], [false, current]]) {
            const wanted = sameName(name, exact);
            for (const r of data) {
                if (!STOP_TYPES[r.category]?.includes(r.type)) continue;
                if (metresBetween({ lat, lon }, { lat: Number(r.lat), lon: Number(r.lon) }) > NEAR_METRES) continue;
                // The stop must carry the timetable's name itself: the search also
                // matches on nearby streets and other names, and the closest bus
                // stop is then a different one ("捷運善導寺站" came back as
                // "Beiping & Linsen Intersection").
                if (!namesOf(r.namedetails).some(wanted)) continue;
                const english = (r.namedetails?.['name:en'] || r.name || '').trim();
                if (english && isLatin(english) && english.length <= 160) return english;
            }
        }
        return null;
    });
}

// The town or city at a point (Nominatim reverse, zoom 10), for showing
// where a stay is without saying which building. Null when there is none.
async function townAt(lat, lon) {
    const key = `town:${lat.toFixed(3)},${lon.toFixed(3)}`;
    return throttled(key, async () => {
        const r = await fetchJson({ lat: String(lat), lon: String(lon), zoom: '10', addressdetails: '1' }, 'https://nominatim.openstreetmap.org/reverse');
        const a = r?.address || {};
        return a.city || a.town || a.village || a.municipality || a.county || a.state || null;
    });
}

// The address at a point (Nominatim reverse, building level), for a place
// the route finder made from a stop, which only has a name and coordinates.
async function addressAt(lat, lon) {
    return throttled(`addr2:${lat.toFixed(5)},${lon.toFixed(5)}`, async () => {
        const r = await fetchJson({ lat: String(lat), lon: String(lon), zoom: '18' }, 'https://nominatim.openstreetmap.org/reverse');
        // Without parts only in the local script (often the name of whatever
        // building is nearest, not of the station), as the app is in English.
        const parts = String(r?.display_name || '').split(',').map(x => x.trim()).filter(x => x && isLatin(x));
        return parts.join(', ').slice(0, 300) || null;
    });
}

// The English name of a railway station known only by name: a line's end
// station or a headsign ("枋寮"), which are not stops of the search and have
// no coordinates. Searched in a box around `near` (the leg), and only taken
// from a station or halt whose current name is exactly that.
async function englishStationByName(name, near) {
    if (!name || isLatin(name) || !near) return null;
    const d = 4; // about 400 km each way: a line's ends can be a country apart (七堵-枋寮)
    return throttled(`station:${name}|${near.lat.toFixed(1)},${near.lon.toFixed(1)}`, async () => {
        const data = await fetchJson({
            q: name, limit: '10', namedetails: '1', bounded: '1',
            viewbox: [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(','),
        });
        const wanted = sameName(name, true);
        for (const r of data) {
            const station = (r.category === 'railway' && ['station', 'halt'].includes(r.type))
                || (r.category === 'public_transport' && r.type === 'station')
                || (r.category === 'building' && r.type === 'train_station');
            if (!station) continue;
            const current = Object.entries(r.namedetails || {}).filter(([k]) => k === 'name' || k.startsWith('name:')).map(([, v]) => v);
            if (!current.some(wanted)) continue;
            const english = (r.namedetails?.['name:en'] || '').trim();
            if (english && isLatin(english) && english.length <= 160) return english;
        }
        return null;
    });
}

module.exports = { search, fromPhoton, dedupe, englishStopName, englishStationByName, isLatin, metresBetween, townAt, addressAt };
