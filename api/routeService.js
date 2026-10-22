// routeService.js
//
// Public-transport connections between two places, from Transitous (a
// community-run MOTIS 2 instance). Its usage policy asks for an identifying
// User-Agent with a version and a way of contact, attribution where results
// are shown, and a light touch — so identical searches are cached for a few
// minutes and requests go out one at a time.
//
// Transitous works in UTC; Splitty stores local wall-clock times with no
// timezone. A search time is read in the zone of the place it belongs to (the
// origin for "depart after", the destination for "arrive by"), and every leg
// comes back in the zones of its own stops.
const tzlookup = require('@photostructure/tz-lookup');
const { version } = require('./package.json');

const ENDPOINT = 'https://api.transitous.org/api/v5/plan';
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_WAITING = 4;
const MAX_WALK_SECONDS = 30 * 60;
const WIDEN_METRES = 1500;

const MODE_FILTERS = { all: 'TRANSIT', rail: 'RAIL', bus: 'BUS,COACH' };

// Splitty's own TRANSPORT_MODES. Trams and metros are trains here; anything
// without a sensible match (cable cars, on-demand taxis) is "other".
const RAIL_MODES = new Set(['RAIL', 'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL', 'REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN', 'SUBWAY', 'METRO', 'TRAM']);
const STREET_MODES = new Set(['WALK', 'BIKE', 'RENTAL', 'CAR', 'HGV', 'CAR_PARKING', 'CAR_DROPOFF', 'FLEX', 'DEBUG_BUS_ROUTE', 'DEBUG_RAILWAY_ROUTE', 'DEBUG_FERRY_ROUTE']);

const splittyMode = mode =>
    RAIL_MODES.has(mode) ? 'train'
        : mode === 'BUS' || mode === 'COACH' ? 'bus'
            : mode === 'FERRY' ? 'ferry'
                : mode === 'AIRPLANE' ? 'flight'
                    : 'other';

const cache = new Map();
let queue = Promise.resolve();
let waiting = 0;

const userAgent = () => {
    const contact = [process.env.APP_URL || 'self-hosted', process.env.CONTACT_EMAIL].filter(Boolean).join('; ');
    return `Splitty/${version} (${contact})`;
};

// An error whose message can be shown to the user as it is.
class RouteError extends Error {
    constructor(message, status = 502) {
        super(message);
        this.status = status;
    }
}

// ── Time zones ──

const zoneAt = (lat, lon) => {
    try {
        return tzlookup(lat, lon);
    } catch {
        return 'UTC';
    }
};

const formatters = new Map();
const formatterFor = zone => {
    if (!formatters.has(zone)) {
        formatters.set(zone, new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));
    }
    return formatters.get(zone);
};

// The wall clock in `zone` at instant `ms`, as its fields.
const wallClock = (ms, zone) => {
    const parts = Object.fromEntries(formatterFor(zone).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
};

// How far `zone` is ahead of UTC at instant `ms`, in milliseconds.
const offsetAt = (ms, zone) => {
    const w = wallClock(ms, zone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
};

// 'YYYY-MM-DDTHH:MM' read as a wall clock in `zone` -> a Date. The offsets a
// day either side cover any DST change in between; whichever gives back the
// same wall clock is the answer. A time repeated by a change takes its first
// occurrence; a time skipped by one lands just after the gap.
function localToUtc(local, zone) {
    const [date, time] = local.split('T');
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const asUtc = Date.UTC(y, mo - 1, d, h, mi);
    const before = asUtc - offsetAt(asUtc - 86400000, zone);
    const after = asUtc - offsetAt(asUtc + 86400000, zone);
    const matches = ms => {
        const w = wallClock(ms, zone);
        return w.year === y && w.month === mo && w.day === d && w.hour === h && w.minute === mi;
    };
    const found = [before, after].filter(matches).sort((a, b) => a - b)[0];
    return new Date(found ?? before);
}

const pad = n => String(n).padStart(2, '0');

// An instant -> 'YYYY-MM-DDTHH:MM' on the wall clock in `zone`, the format of every trip item.
function utcToLocal(iso, zone) {
    const w = wallClock(Date.parse(iso), zone);
    return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

// ── Transitous ──

async function fetchPlan(params) {
    const url = `${ENDPOINT}?${new URLSearchParams(params)}`;
    let res;
    try {
        res = await fetch(url, {
            headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        if (err.name === 'TimeoutError') throw new RouteError('The route planner took too long to answer. Try again in a moment.', 504);
        throw new RouteError('The route planner (Transitous) can not be reached right now. Try again later.');
    }
    if (res.status === 429) throw new RouteError('The route planner is busy. Wait a minute and try again.', 503);
    if (res.status >= 400 && res.status < 500) {
        // Usually a place outside the timetable data, or a time it has none for.
        throw new RouteError('The route planner could not search between these places at that time.', 422);
    }
    if (!res.ok) throw new RouteError('The route planner (Transitous) is not available right now. Try again later.');
    return res.json();
}

function cached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.data;
}

async function plan(params) {
    const key = JSON.stringify(params);
    const hit = cached(key);
    if (hit) return hit;
    if (waiting >= MAX_WAITING) throw new RouteError('Too many route searches at once. Try again in a moment.', 503);

    // Chain onto the queue so concurrent searches still go out one at a time;
    // the same search asked twice meanwhile is answered from the cache.
    waiting++;
    const result = queue.then(() => cached(key) ?? fetchPlan(params));
    queue = result.catch(() => {});
    let data;
    try {
        data = await result;
    } finally {
        waiting--;
    }

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), data });
    return data;
}

// ── Normalising the answer for the trip page ──

const minutesBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

const stopOf = place => ({
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    tz: place.tz || zoneAt(place.lat, place.lon),
});

function normaliseLeg(leg) {
    const from = stopOf(leg.from), to = stopOf(leg.to);
    // The timetable time, which is what goes on the itinerary; a delay known
    // today says nothing about the day of the trip.
    const startTime = leg.scheduledStartTime || leg.startTime;
    const endTime = leg.scheduledEndTime || leg.endTime;
    const mode = splittyMode(leg.mode);
    return {
        mode,
        transitMode: leg.mode,
        line: leg.displayName || leg.routeShortName || '',
        headsign: leg.headsign || '',
        carrier: leg.agencyName || '',
        // Feeds differ: a train number is in tripShortName when the feed has
        // one at all; a bus is known by its route number.
        number: leg.tripShortName || (mode === 'bus' ? leg.routeShortName || '' : ''),
        title: `${from.name} → ${to.name}`,
        from,
        to,
        start: utcToLocal(startTime, from.tz),
        end: utcToLocal(endTime, to.tz),
        minutes: minutesBetween(startTime, endTime),
        stops: (leg.intermediateStops || []).length,
        startTime,
        endTime,
    };
}

// Walks are not trip items: the one before the first vehicle and after the
// last are kept as minutes, and the ones in between become part of a change.
function normaliseItinerary(itinerary) {
    const legs = [];
    let walkBefore = 0, walkAfter = 0, walking = 0;
    for (const leg of itinerary.legs || []) {
        if (STREET_MODES.has(leg.mode)) {
            // A "walk" from a stop to itself is only the minimum change time.
            const moved = !(leg.from?.stopId && leg.from.stopId === leg.to?.stopId);
            const minutes = moved ? Math.round((leg.duration || 0) / 60) : 0;
            if (legs.length === 0) walkBefore += minutes;
            else walking += minutes;
            continue;
        }
        const next = normaliseLeg(leg);
        const previous = legs[legs.length - 1];
        if (previous) {
            previous.change = {
                at: next.from.name,
                waitMinutes: minutesBetween(previous.endTime, next.startTime),
                walkMinutes: walking,
            };
        }
        walking = 0;
        legs.push(next);
    }
    if (legs.length === 0) return null;
    walkAfter = walking;

    const first = legs[0], last = legs[legs.length - 1];
    return {
        departure: first.start,
        arrival: last.end,
        minutes: minutesBetween(first.startTime, last.endTime),
        changes: legs.length - 1,
        walkBefore,
        walkAfter,
        legs: legs.map(({ startTime, endTime, ...leg }) => leg),
    };
}

// from / to: { lat, lon }. when: local 'YYYY-MM-DDTHH:MM' at the origin
// (depart after) or the destination (arrive by). cursor: a page cursor from an
// earlier answer, for earlier or later connections; wide: that answer was widened.
//
// A place with no street path to a stop (an airport's centre, a town's
// centroid in a pedestrian-unfriendly spot) finds nothing; then the search is
// tried once more from every stop within WIDEN_METRES, with walking times
// estimated as the crow flies (MOTIS's experimental `radius`).
async function search({ from, to, when, arriveBy, modes, cursor, wide }) {
    const zone = arriveBy ? zoneAt(to.lat, to.lon) : zoneAt(from.lat, from.lon);
    const coords = p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    const params = {
        fromPlace: coords(from),
        toPlace: coords(to),
        time: localToUtc(when, zone).toISOString().replace('.000Z', 'Z'),
        arriveBy: String(Boolean(arriveBy)),
        transitModes: MODE_FILTERS[modes] || MODE_FILTERS.all,
        // Trip places are often a town's or an airport's centre, further from
        // a stop than the default 15 minutes' walk; the server caps this anyway.
        maxPreTransitTime: String(MAX_WALK_SECONDS),
        maxPostTransitTime: String(MAX_WALK_SECONDS),
        // No street geometry or walking directions: the page shows neither.
        detailedTransfers: 'false',
        detailedLegs: 'false',
        language: 'en',
        ...(cursor ? { pageCursor: cursor } : {}),
    };
    const widen = p => ({ ...p, radius: String(WIDEN_METRES) });
    let widened = Boolean(wide);
    let data = await plan(widened ? widen(params) : params);
    if (!widened && !cursor && (data.itineraries || []).length === 0) {
        widened = true;
        data = await plan(widen(params));
    }
    return {
        zone,
        widened,
        widenedMetres: widened ? WIDEN_METRES : null,
        itineraries: (data.itineraries || []).map(normaliseItinerary).filter(Boolean),
        previousCursor: data.previousPageCursor || null,
        nextCursor: data.nextPageCursor || null,
    };
}

module.exports = { search, zoneAt, localToUtc, utcToLocal, RouteError, MODE_FILTERS };
