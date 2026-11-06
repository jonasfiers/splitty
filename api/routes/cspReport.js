// POST /csp-report — browsers report here what the Content Security Policy
// blocked (nginx sends the policy; scripts/setup-security-headers.sh). Public:
// the browser sends these on its own, without the user's token. Each kind of
// violation is logged once an hour, so a broken page cannot flood the journal.
// Only the page's path is kept, never its query string.
const express = require('express');

const router = express.Router();

const ONCE_PER_MS = 60 * 60 * 1000;
const MAX_KINDS = 200;
const seen = new Map(); // kind -> last logged

const pathOnly = u => {
    try {
        const url = new URL(u);
        return url.protocol.startsWith('http') ? url.origin + url.pathname : url.protocol;
    } catch {
        return String(u || '').slice(0, 40);
    }
};

router.post('/', express.json({
    type: ['application/csp-report', 'application/reports+json', 'application/json'],
    limit: '8kb',
}), (req, res) => {
    // report-uri sends { "csp-report": {...} }; the Reporting API an array of
    // { type, body: {...} } with camelCase names.
    const raw = req.body?.['csp-report'] || (Array.isArray(req.body) ? req.body[0]?.body : null);
    if (raw && typeof raw === 'object') {
        const directive = String(raw['effective-directive'] || raw.effectiveDirective || raw['violated-directive'] || '?').slice(0, 40);
        const blocked = pathOnly(raw['blocked-uri'] ?? raw.blockedURL);
        const page = pathOnly(raw['document-uri'] ?? raw.documentURL);
        const where = raw['source-file'] || raw.sourceFile;
        const line = raw['line-number'] ?? raw.lineNumber;
        const kind = `${directive} ${blocked}`;
        const now = Date.now();
        if (!(now - (seen.get(kind) || 0) < ONCE_PER_MS)) {
            if (seen.size >= MAX_KINDS) seen.clear();
            seen.set(kind, now);
            console.warn(`CSP blocked: ${directive} ${blocked} on ${page}` +
                (where ? ` (${pathOnly(where)}${line ? `:${line}` : ''})` : ''));
        }
    }
    res.status(204).end();
});

module.exports = router;
