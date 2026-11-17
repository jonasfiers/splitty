const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { userServiceNeo4j, passkeyService, tokenService } = require('../crudService');
const emailService = require('../emailService');

// A short, human label for the device a passkey is created on, from the
// User-Agent: "iPhone · Safari", "Mac · Chrome", "Android · Chrome"... Only
// a hint for the user to tell their passkeys apart; never used for security.
function deviceLabel(ua = '') {
    const os = /iPhone/.test(ua) ? 'iPhone'
        : /iPad/.test(ua) ? 'iPad'
        : /Android/.test(ua) ? 'Android'
        : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
        : /Windows/.test(ua) ? 'Windows'
        : /CrOS/.test(ua) ? 'Chromebook'
        : /Linux/.test(ua) ? 'Linux'
        : null;
    const browser = /Edg\//.test(ua) ? 'Edge'
        : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
        : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
        : null;
    return [os, browser].filter(Boolean).join(' · ') || null;
}

// Email addresses are case-insensitive: stored and compared lowercase.
const normEmail = e => (typeof e === 'string' ? e.trim().toLowerCase() : '');
// Deliberately loose: one @, something on both sides, a dot in the domain.
// The verification email is the real check.
const isEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const MAX_NAME = 80;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const passwordProblem = p =>
    typeof p !== 'string' || p.length < MIN_PASSWORD ? `Password must be at least ${MIN_PASSWORD} characters long`
    : p.length > MAX_PASSWORD ? `Password can be at most ${MAX_PASSWORD} characters long`
    : null;

const signSession = user => jwt.sign(
    { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor ?? null, avatarEmoji: user.avatarEmoji ?? null },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
);

// Unexpected errors: the details go to the log, never to the client.
function serverError(res, where, err, message = 'Something went wrong. Please try again.') {
    console.error(`[auth] ${where}:`, err);
    res.status(500).json({ error: message });
}

// lazy-load ESM-only @simplewebauthn/server
let _webauthn;
async function webauthn() {
    if (!_webauthn) _webauthn = await import('@simplewebauthn/server');
    return _webauthn;
}

// in-memory challenge stores with 60s TTL
const registrationChallenges = new Map();
const loginChallenges = new Map();

// A minute to answer a challenge; five for the passkey autofill on the login
// page, which asks on page load and is answered whenever the field is tapped
// (the page renews it before then). Expired ones are swept out here, so
// challenges nobody answered don't pile up.
// At most this many waiting at once, whatever floods the (unauthenticated)
// options endpoint: past it the oldest go first.
const MAX_CHALLENGES = 10_000;
function storeChallenge(map, key, challenge, ttl = 60_000) {
    const now = Date.now();
    for (const [k, v] of map) if (now > v.expires) map.delete(k);
    while (map.size >= MAX_CHALLENGES) map.delete(map.keys().next().value);
    map.set(key, { challenge, expires: now + ttl });
}

function consumeChallenge(map, key) {
    const entry = map.get(key);
    map.delete(key);
    if (!entry || Date.now() > entry.expires) return null;
    return entry.challenge;
}

// REGISTER (password)
// The answer is the same whether or not the address already has an account,
// so sign-up can't be used to find out who uses Splitty: an existing owner
// gets an email instead ("someone tried to sign up with your address").
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { name: rawName, email: rawEmail, password } = req.body;
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        const email = normEmail(rawEmail);

        if (!name || !email || password == null || password === '') {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (name.length > MAX_NAME) return res.status(400).json({ error: `Name can be at most ${MAX_NAME} characters long` });
        if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
        const badPassword = passwordProblem(password);
        if (badPassword) return res.status(400).json({ error: badPassword });

        // Hashed in both cases, so both take about as long.
        const hashedPassword = await bcrypt.hash(password, 10);
        const existingUser = await userServiceNeo4j.getUserByEmail(email);
        const exists = Boolean(existingUser && existingUser.id);
        const created = exists ? null : await userServiceNeo4j.createUser(name, email, hashedPassword);

        res.status(201).json({ success: true, verificationPending: true });

        // Mail after answering, for both paths alike.
        if (exists) {
            emailService.sendAccountExistsEmail(existingUser.email, `${process.env.APP_URL}/login`, `${process.env.APP_URL}/forgot-password`)
                .catch(err => console.error('[auth] account-exists email failed:', err));
            return;
        }
        try {
            const verifyToken = await tokenService.create('EmailVerification', { userId: created.id }, 24 * 60 * 60 * 1000);
            await emailService.sendVerificationEmail(email, `${process.env.APP_URL}/verify-email?token=${verifyToken}`);
        } catch (emailErr) {
            console.error('[auth] verification email failed:', emailErr);
        }
        // A failed notice must never affect the sign-up.
        emailService.sendSignupNotice(name, email)
            .catch(err => console.error('[auth] sign-up notice failed:', err));
    } catch (error) {
        if (res.headersSent) return console.error('[auth] register (after answering):', error);
        serverError(res, 'register', error);
    }
});

// LOGIN (password)
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { password } = req.body;
        const email = normEmail(req.body.email);

        if (typeof password !== 'string' || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await userServiceNeo4j.getUserByEmail(email);
        if (!user || !user.id) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        if (user.emailVerified === false) {
            return res.status(403).json({ error: 'Please verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED' });
        }

        res.json({ token: signSession(user) });
    } catch (error) {
        serverError(res, 'login', error);
    }
});

// VERIFY EMAIL
router.get('/verify-email', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });
    try {
        const t = await tokenService.consume('EmailVerification', token);
        if (!t) return res.status(400).json({ error: 'Token invalid or expired' });
        await userServiceNeo4j.verifyEmail(t.userId);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to verify email' });
    }
});

// VERIFY EMAIL CHANGE
router.get('/verify-email-change', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token required' });
    try {
        const t = await tokenService.consume('EmailChange', token);
        if (!t) return res.status(400).json({ error: 'Token invalid or expired' });
        await userServiceNeo4j.applyPendingEmail(t.userId);
        const { user } = await userServiceNeo4j.getUserByIdDirect(t.userId);
        res.json({ success: true, token: signSession(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to verify email change' });
    }
});

// CHANGE PASSWORD
router.post('/change-password', authMiddleware, authLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || !currentPassword || !newPassword) return res.status(400).json({ error: 'Missing required fields' });
    const badPassword = passwordProblem(newPassword);
    if (badPassword) return res.status(400).json({ error: badPassword });
    try {
        const user = await userServiceNeo4j.getUserByEmail(req.user.email);
        if (!user || !user.id) return res.status(401).json({ error: 'User not found' });
        if (!user.password) return res.status(400).json({ error: 'No password set — sign in with a passkey instead' });
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        // Every other device is signed out; this one gets a fresh token.
        const cutoff = Math.floor(Date.now() / 1000);
        await userServiceNeo4j.setPassword(req.user.id, hashedPassword, cutoff);
        authMiddleware.noteSessionCutoff(req.user.id, cutoff);
        const { user: fresh } = await userServiceNeo4j.getUserByIdDirect(req.user.id);
        res.json({ success: true, token: signSession(fresh) });
    } catch (error) {
        serverError(res, 'change-password', error);
    }
});

// RESEND VERIFICATION EMAIL
router.post('/resend-verification', authLimiter, async (req, res) => {
    const email = normEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
        const user = await userServiceNeo4j.getUserByEmail(email);
        if (user && user.id && user.emailVerified === false) {
            const verifyToken = await tokenService.create('EmailVerification', { userId: user.id }, 24 * 60 * 60 * 1000);
            const verifyUrl = `${process.env.APP_URL}/verify-email?token=${verifyToken}`;
            await emailService.sendVerificationEmail(user.email, verifyUrl);
        }
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// PASSKEY REGISTRATION — requires the user to be logged in

router.post('/passkey/register/options', authMiddleware, authLimiter, async (req, res) => {
    try {
        const { generateRegistrationOptions } = await webauthn();
        const { passkeys } = await passkeyService.getPasskeysByUserId(req.user.id);
        const options = await generateRegistrationOptions({
            rpName: process.env.RP_NAME || 'Splitty',
            rpID: process.env.RP_ID || 'localhost',
            userID: Buffer.from(req.user.id, 'utf-8'),
            userName: req.user.email,
            attestation: 'none',
            // Discoverable, always: sign-in asks for any passkey of this site, never one
            // looked up by email (that would tell anyone which emails have passkeys).
            authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
            excludeCredentials: passkeys.map(p => ({
                id: p.credentialId,
                transports: JSON.parse(p.transports || '[]'),
            })),
        });
        storeChallenge(registrationChallenges, req.user.id, options.challenge);
        res.json(options);
    } catch (err) {
        serverError(res, '/passkey/register/options', err);
    }
});

router.post('/passkey/register/verify', authMiddleware, authLimiter, async (req, res) => {
    try {
        const { verifyRegistrationResponse } = await webauthn();
        const challenge = consumeChallenge(registrationChallenges, req.user.id);
        if (!challenge) return res.status(400).json({ error: 'Challenge expired or not found' });

        const { verified, registrationInfo } = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge: challenge,
            expectedOrigin: process.env.RP_ORIGIN ? process.env.RP_ORIGIN.split(',') : ['http://localhost', 'http://localhost:5173'],
            expectedRPID: process.env.RP_ID || 'localhost',
            requireUserVerification: false,
        });

        if (!verified) return res.status(400).json({ error: 'Verification failed' });

        const { credential } = registrationInfo;
        await passkeyService.createPasskey(
            req.user.id,
            credential.id,
            Buffer.from(credential.publicKey).toString('base64url'),
            credential.counter,
            JSON.stringify(credential.transports || []),
            deviceLabel(req.get('user-agent')),
        );

        res.json({ success: true });
    } catch (err) {
        serverError(res, '/passkey/register/verify', err);
    }
});

// PASSKEY LOGIN — public

router.post('/passkey/login/options', authLimiter, async (req, res) => {
    try {
        const { generateAuthenticationOptions } = await webauthn();
        // An open request: any passkey of this site, whoever's it is. Not the
        // passkeys of a given email: their list would tell anyone asking
        // whether that email has an account with passkeys. (The account
        // follows from the passkey chosen, in /login/verify.)
        const { autofill } = req.body;

        const options = await generateAuthenticationOptions({
            rpID: process.env.RP_ID || 'localhost',
            userVerification: 'preferred',
            allowCredentials: [],
        });

        const nonce = crypto.randomUUID();
        storeChallenge(loginChallenges, nonce, options.challenge, autofill ? 5 * 60_000 : 60_000);
        res.json({ options, nonce });
    } catch (err) {
        serverError(res, '/passkey/login/options', err);
    }
});

router.post('/passkey/login/verify', authLimiter, async (req, res) => {
    try {
        const { verifyAuthenticationResponse } = await webauthn();
        const { nonce, assertionResponse } = req.body;

        const challenge = consumeChallenge(loginChallenges, nonce);
        if (!challenge) return res.status(400).json({ error: 'Challenge expired or not found' });

        const passkey = await passkeyService.getPasskeyByCredentialId(assertionResponse.id);
        if (!passkey) return res.status(401).json({ error: 'Passkey not found' });

        const { verified, authenticationInfo } = await verifyAuthenticationResponse({
            response: assertionResponse,
            expectedChallenge: challenge,
            expectedOrigin: process.env.RP_ORIGIN ? process.env.RP_ORIGIN.split(',') : ['http://localhost', 'http://localhost:5173'],
            expectedRPID: process.env.RP_ID || 'localhost',
            requireUserVerification: false,
            credential: {
                id: passkey.credentialId,
                publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
                counter: Number(passkey.counter),
                transports: JSON.parse(passkey.transports || '[]'),
            },
        });

        if (!verified) return res.status(401).json({ error: 'Authentication failed' });

        await passkeyService.updatePasskeyCounter(passkey.credentialId, authenticationInfo.newCounter);

        const { user } = await userServiceNeo4j.getUserByIdDirect(passkey.userId);
        res.json({ token: signSession(user) });
    } catch (err) {
        serverError(res, '/passkey/login/verify', err);
    }
});

// LIST PASSKEYS — requires auth

router.get('/passkey/list', authMiddleware, async (req, res) => {
    try {
        const { passkeys } = await passkeyService.getPasskeysByUserId(req.user.id);
        // Only what the profile page shows: not the public key or counter.
        res.json({ passkeys: passkeys.map(p => ({
            credentialId: p.credentialId,
            name: p.name ?? null,
            createdAt: p.createdAt ?? null,
            lastUsedAt: p.lastUsedAt ?? null,
        })) });
    } catch (err) {
        serverError(res, '/passkey/list', err);
    }
});

// DELETE PASSKEY — requires auth

router.delete('/passkey/:credentialId', authMiddleware, async (req, res) => {
    try {
        const result = await passkeyService.deletePasskey(
            decodeURIComponent(req.params.credentialId),
            req.user.id,
        );
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (err) {
        serverError(res, '/passkey/:credentialId', err);
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', authLimiter, async (req, res) => {
    const email = normEmail(req.body.email);
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
        const user = await userServiceNeo4j.getUserByEmail(email);
        if (user && user.id) {
            const token = await tokenService.create('Password', { userId: user.id }, 60 * 60 * 1000);
            const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;
            await emailService.sendPasswordResetEmail(user.email, resetUrl);
        }
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// RESET PASSWORD
router.post('/reset-password', authLimiter, async (req, res) => {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !token || !password) return res.status(400).json({ error: 'Missing required fields' });
    const badPassword = passwordProblem(password);
    if (badPassword) return res.status(400).json({ error: badPassword });
    try {
        const t = await tokenService.consume('Password', token);
        if (!t) return res.status(400).json({ error: 'Token invalid or expired' });
        const hashedPassword = await bcrypt.hash(password, 10);
        // Signs out every device (whoever may have had the old password).
        const cutoff = Math.floor(Date.now() / 1000);
        await userServiceNeo4j.setPassword(t.userId, hashedPassword, cutoff);
        authMiddleware.noteSessionCutoff(t.userId, cutoff);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

module.exports = router;