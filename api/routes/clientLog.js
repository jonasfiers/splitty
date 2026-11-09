// POST /client-log — the web app reports requests that ended without any
// answer from the server (api/client.js in the web app), sent once the server
// answers again, so we can see which ones break off and why. Public like
// /csp-report: it is sent after the fact, maybe from the login page. Only
// paths (no query strings), error codes and timings; each kind is logged at
// most once a minute, at most 20 events per report.
const express = require('express');

const router = express.Router();

const ONCE_PER_MS = 60 * 1000;
const MAX_KINDS = 200;
const seen = new Map(); // kind -> last logged

const clean = (v, max) => String(v ?? '').replace(/[^\w/:.\- ]/g, '').slice(0, max);

router.post('/', express.json({ limit: '4kb' }), (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 20) : [];
    const now = Date.now();
    for (const e of events) {
        const path = clean(e.path, 80).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
        const kind = `${clean(e.method, 6)} ${path} ${clean(e.code, 24)}`;
        if (now - (seen.get(kind) || 0) < ONCE_PER_MS) continue;
        if (seen.size >= MAX_KINDS) seen.clear();
        seen.set(kind, now);
        console.warn(`[client-net] ${kind} after ${Math.round(Number(e.ms) || 0)}ms`
            + ` online=${e.online === true} retry=${clean(e.retry, 12) || 'none'} page=${clean(e.page, 60)}`);
    }
    res.status(204).end();
});

module.exports = router;
