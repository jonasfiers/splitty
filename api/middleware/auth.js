const jwt = require('jsonwebtoken');
const { isDeleted } = require('../accountDeletion');
const { userServiceNeo4j } = require('../crudService');

// Per-account session cut-off (User.sessionsValidFrom, unix seconds): a token
// issued before it no longer works. Set when the password changes or is reset
// (crudService setPassword), so that signs out every other device.
//
// Looked up per request through a short cache. The API is one process and
// every password change goes through noteSessionCutoff() below, so the cache
// is updated at once; the TTL only covers changes made outside the API.
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5_000;
const cache = new Map(); // userId -> { exists, validFrom, at }

async function sessionState(userId) {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
    const state = { ...(await userServiceNeo4j.getSessionState(userId)), at: Date.now() };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(userId, state);
    return state;
}

const auth = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>
    if (!token) return res.status(401).json({ error: 'No token provided' });

    let claims;
    try {
        claims = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
    // A token issued before the account was deleted stops working at once.
    if (isDeleted(claims.id)) return res.status(401).json({ error: 'This account has been deleted' });

    let state;
    try {
        state = await sessionState(claims.id);
    } catch (err) {
        console.error('[auth] session check failed:', err);
        return res.status(503).json({ error: 'Please try again in a moment.' });
    }
    if (!state.exists) return res.status(401).json({ error: 'Invalid token' });
    if (typeof claims.iat !== 'number' || claims.iat < state.validFrom) {
        return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    }
    req.user = claims;
    next();
};

// Called right after a password change or reset, with the new cut-off.
auth.noteSessionCutoff = (userId, validFrom) => {
    cache.set(userId, { exists: true, validFrom, at: Date.now() });
};

module.exports = auth;
