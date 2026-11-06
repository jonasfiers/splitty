// GET /tiles/:z/:x/:y.png — OpenStreetMap tiles through Splitty (see
// ../tileProxy.js). Public: Leaflet loads tiles as plain <img>s, which cannot
// send the Authorization header, and the tiles hold nothing private.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { parseTile, fromOtherSite, fetchTile } = require('../tileProxy');

const router = express.Router();

// Only tiles nginx has no copy of get here. A map fills its view with 20-60
// tiles at once, and zooming around a new area asks for many more: a minute
// of that in Firefox on QA was 823 tiles. OpenStreetMap itself is protected
// by tileProxy's cap on parallel fetches; this only stops one client hogging.
// (On QA every visitor shares CT115's address, so they share this limit.)
const tileLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1500,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).set('Cache-Control', 'no-store').end(),
});

const fail = (res, status) => res.status(status).set('Cache-Control', 'no-store').end();

router.get('/:z/:x/:y.png', tileLimiter, async (req, res) => {
    const tile = parseTile(req.params.z, req.params.x, req.params.y);
    if (!tile) return fail(res, 400);
    if (fromOtherSite(req)) return fail(res, 403);

    const conditional = {};
    if (req.get('if-none-match')) conditional['If-None-Match'] = req.get('if-none-match');
    if (req.get('if-modified-since')) conditional['If-Modified-Since'] = req.get('if-modified-since');

    try {
        const { status, headers, body } = await fetchTile(tile, conditional);
        if (status !== 200 && status !== 304) return fail(res, status);
        res.status(status).set(headers);
        return body ? res.end(body) : res.end();
    } catch (err) {
        if (err.busy) return fail(res, 503);
        console.error(`Tile ${tile.z}/${tile.x}/${tile.y} failed:`, err.message);
        return fail(res, 502);
    }
});

module.exports = router;
