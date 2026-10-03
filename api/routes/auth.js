const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const authMiddleware = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { userServiceNeo4j, passkeyService, tokenService } = require('../crudService');
const emailService = require('../emailService');

// lazy-load ESM-only @simplewebauthn/server
let _webauthn;
async function webauthn() {
    if (!_webauthn) _webauthn = await import('@simplewebauthn/server');
    return _webauthn;
}

// in-memory challenge stores with 60s TTL
const registrationChallenges = new Map();
const loginChallenges = new Map();

function storeChallenge(map, key, challenge) {
    map.set(key, { challenge, expires: Date.now() + 60_000 });
}

function consumeChallenge(map, key) {
    const entry = map.get(key);
    map.delete(key);
    if (!entry || Date.now() > entry.expires) return null;
    return entry.challenge;
}

// REGISTER (password)
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        const existingUser = await userServiceNeo4j.getUserByEmail(email);
        if (existingUser && existingUser.id) {
            return res.status(400).json({ error: 'Email already in use' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await userServiceNeo4j.createUser(name, email, hashedPassword);

        try {
            const verifyToken = await tokenService.create('EmailVerification', { userId: result.id }, 24 * 60 * 60 * 1000);
            const verifyUrl = `${process.env.APP_URL}/verify-email?token=${verifyToken}`;
            await emailService.sendVerificationEmail(email, verifyUrl);
        } catch (emailErr) {
            console.error('Failed to send verification email:', emailErr);
        }

        res.status(201).json({ success: true, verificationPending: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// LOGIN (password)
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = await userServiceNeo4j.getUserByEmail(email);
        if (!user || !user.id) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        if (user.emailVerified === false) {
            return res.status(403).json({ error: 'Please verify your email before signing in.', code: 'EMAIL_NOT_VERIFIED' });
        }

        const token = jwt.sign({ id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor ?? null, avatarEmoji: user.avatarEmoji ?? null }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        const freshToken = jwt.sign(
            { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor ?? null, avatarEmoji: user.avatarEmoji ?? null },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({ success: true, token: freshToken });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to verify email change' });
    }
});

// CHANGE PASSWORD
router.post('/change-password', authMiddleware, authLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Missing required fields' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    try {
        const user = await userServiceNeo4j.getUserByEmail(req.user.email);
        if (!user || !user.id) return res.status(401).json({ error: 'User not found' });
        if (!user.password) return res.status(400).json({ error: 'No password set — sign in with a passkey instead' });
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await userServiceNeo4j.setPassword(req.user.id, hashedPassword);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// RESEND VERIFICATION EMAIL
router.post('/resend-verification', authLimiter, async (req, res) => {
    const { email } = req.body;
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
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
            excludeCredentials: passkeys.map(p => ({
                id: p.credentialId,
                transports: JSON.parse(p.transports || '[]'),
            })),
        });
        storeChallenge(registrationChallenges, req.user.id, options.challenge);
        res.json(options);
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PASSKEY LOGIN — public

router.post('/passkey/login/options', authLimiter, async (req, res) => {
    try {
        const { generateAuthenticationOptions } = await webauthn();
        const { email } = req.body;
        let allowCredentials = [];

        if (email) {
            const user = await userServiceNeo4j.getUserByEmail(email);
            if (user && user.id) {
                const { passkeys } = await passkeyService.getPasskeysByUserId(user.id);
                allowCredentials = passkeys.map(p => ({
                    id: p.credentialId,
                    transports: JSON.parse(p.transports || '[]'),
                }));
            }
        }

        const options = await generateAuthenticationOptions({
            rpID: process.env.RP_ID || 'localhost',
            userVerification: 'preferred',
            allowCredentials,
        });

        const nonce = crypto.randomUUID();
        storeChallenge(loginChallenges, nonce, options.challenge);
        res.json({ options, nonce });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor ?? null, avatarEmoji: user.avatarEmoji ?? null }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LIST PASSKEYS — requires auth

router.get('/passkey/list', authMiddleware, async (req, res) => {
    try {
        const { passkeys } = await passkeyService.getPasskeysByUserId(req.user.id);
        res.json({ passkeys });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body;
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
    if (!token || !password) return res.status(400).json({ error: 'Missing required fields' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    try {
        const t = await tokenService.consume('Password', token);
        if (!t) return res.status(400).json({ error: 'Token invalid or expired' });
        const hashedPassword = await bcrypt.hash(password, 10);
        await userServiceNeo4j.setPassword(t.userId, hashedPassword);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

module.exports = router;