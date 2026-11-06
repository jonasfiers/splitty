// tileProxy.js
//
// Map tiles through Splitty: the browser asks /api/tiles/{z}/{x}/{y}.png and
// the API fetches the tile from OpenStreetMap, so OpenStreetMap sees Splitty's
// server, never the visitor. nginx in front (CT101, CT116) keeps a copy of
// every tile, honouring OpenStreetMap's cache headers, so most requests never
// reach this code. See docs/deploying.md, "Map tile cache".
//
// OpenStreetMap's tile usage policy (operations.osmfoundation.org/policies/
// tiles) asks for an identifying User-Agent, caching that follows their
// headers, and no bulk downloading. Hence: an identifying User-Agent,
// conditional requests passed through (so nginx can revalidate an expired
// copy with a cheap 304), a cap on parallel fetches, and refusing tile
// requests that come from another website (Sec-Fetch-Site), so nobody can use
// Splitty as a free tile server for their own map.

const UPSTREAM = 'https://tile.openstreetmap.org';
const MAX_ZOOM = 19;
const MAX_PARALLEL = 4;      // upstream fetches at once
const MAX_WAITING = 64;      // beyond this, answer 503 at once
const TIMEOUT_MS = 10000;
const MAX_BYTES = 1024 * 1024;

const userAgent = () => `Splitty/1.0 (${process.env.APP_URL || 'self-hosted'}; tile proxy)`;

// Headers worth keeping from OpenStreetMap's answer: the type, and what
// nginx and the browser need to cache and revalidate.
const PASS_HEADERS = ['content-type', 'cache-control', 'expires', 'etag', 'last-modified'];

let active = 0;
const waiting = [];

async function withSlot(fn) {
    if (active >= MAX_PARALLEL) {
        if (waiting.length >= MAX_WAITING) throw Object.assign(new Error('Tile queue is full'), { busy: true });
        await new Promise(resolve => waiting.push(resolve));
    } else {
        active++;
    }
    try {
        return await fn();
    } finally {
        const next = waiting.shift();
        if (next) next(); else active--;   // a waiter inherits the slot
    }
}

// z, x and y as integers within the tile grid, or null.
function parseTile(z, x, y) {
    // One spelling per tile (no leading zeros), so one cache entry per tile.
    if (![z, x, y].every(v => /^(0|[1-9]\d{0,6})$/.test(v))) return null;
    const [zi, xi, yi] = [z, x, y].map(Number);
    if (zi > MAX_ZOOM) return null;
    const n = 2 ** zi;
    if (xi >= n || yi >= n) return null;
    return { z: zi, x: xi, y: yi };
}

// A browser says where a request comes from; a tile for another site's page
// is refused. Requests without the header (older browsers, curl) pass: the
// rate limits cover those.
function fromOtherSite(req) {
    const site = req.get('sec-fetch-site');
    return site !== undefined && site !== 'same-origin' && site !== 'none';
}

// { status, headers, body } for one tile. `conditional` holds the request's
// If-None-Match / If-Modified-Since, passed on so OpenStreetMap can answer 304.
async function fetchTile({ z, x, y }, conditional) {
    return withSlot(async () => {
        const res = await fetch(`${UPSTREAM}/${z}/${x}/${y}.png`, {
            headers: { 'User-Agent': userAgent(), ...conditional },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            redirect: 'error',
        });
        const headers = {};
        for (const h of PASS_HEADERS) {
            const v = res.headers.get(h);
            if (v) headers[h] = v;
        }
        if (res.status === 304) return { status: 304, headers, body: null };
        if (!res.ok) {
            await res.body?.cancel();
            return { status: res.status === 404 ? 404 : 502, headers: {}, body: null };
        }
        if (!(headers['content-type'] || '').startsWith('image/')) {
            await res.body?.cancel();
            return { status: 502, headers: {}, body: null };
        }
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > MAX_BYTES) return { status: 502, headers: {}, body: null };
        // OpenStreetMap always sends one; without it, keep a tile a day.
        headers['cache-control'] ??= 'public, max-age=86400';
        return { status: 200, headers, body };
    });
}

module.exports = { parseTile, fromOtherSite, fetchTile, MAX_ZOOM };
