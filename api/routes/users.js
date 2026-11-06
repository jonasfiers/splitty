const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { userServiceNeo4j, tokenService } = require('../crudService');
const emailService = require('../emailService');
const accountDeletion = require('../accountDeletion');

// (There is no POST /: accounts are created only through /auth/register.)

// READ ALL
router.get('/', async (req, res) => {
    try {
        const users = await userServiceNeo4j.getAllUsers(req.user.id);
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ONE
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userServiceNeo4j.getUserById(id, req.user.id);
        if (!user.success) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.id !== id) {
            return res.status(403).json({ error: 'You can only update your own profile' });
        }
        const { name, email, avatarColor, avatarEmoji } = req.body;

        if (name) {
            await userServiceNeo4j.updateUserName(id, name);
        }

        if (avatarColor !== undefined || avatarEmoji !== undefined) {
            if (avatarColor !== undefined) {
                const idx = Number(avatarColor);
                if (!Number.isInteger(idx) || idx < 0 || idx > 7) {
                    return res.status(400).json({ error: 'avatarColor must be an integer 0–7' });
                }
            }
            await userServiceNeo4j.updateAvatarPrefs(
                id,
                avatarColor !== undefined ? Number(avatarColor) : (req.user.avatarColor ?? null),
                avatarEmoji !== undefined ? avatarEmoji : (req.user.avatarEmoji ?? null)
            );
        }

        let emailChangePending = false;
        if (email && email !== req.user.email) {
            const existing = await userServiceNeo4j.getUserByEmail(email);
            if (existing && existing.id && existing.id !== id) {
                return res.status(400).json({ error: 'Email already in use' });
            }
            await userServiceNeo4j.setPendingEmail(id, email);
            const verifyToken = await tokenService.create('EmailChange', { userId: id, pendingEmail: email }, 24 * 60 * 60 * 1000);
            const verifyUrl = `${process.env.APP_URL}/verify-email-change?token=${verifyToken}`;
            await emailService.sendEmailChangeVerification(email, verifyUrl);
            emailChangePending = true;
        }

        const freshToken = jwt.sign(
            {
                id: req.user.id,
                email: req.user.email,
                name: name || req.user.name,
                avatarColor: avatarColor !== undefined ? Number(avatarColor) : (req.user.avatarColor ?? null),
                avatarEmoji: avatarEmoji !== undefined ? avatarEmoji : (req.user.avatarEmoji ?? null),
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        res.json({ success: true, token: freshToken, emailChangePending });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE — the user's own account (GDPR erasure): see accountDeletion.js.
// The body must repeat the account's email address ({ confirmEmail }), so a
// stray request or a stolen token alone cannot delete an account by accident.
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.id !== id) {
            return res.status(403).json({ error: 'You can only delete your own account' });
        }
        if (!accountDeletion.isConfigured()) {
            return res.status(503).json({ error: 'Account deletion is not available right now. Email hello@jonasfiers.eu.' });
        }
        const { user } = await userServiceNeo4j.getUserByIdDirect(id);
        if (!user) return res.status(404).json({ error: 'Account not found' });
        const confirm = String(req.body?.confirmEmail ?? '').trim().toLowerCase();
        if (!user.email || confirm !== String(user.email).toLowerCase()) {
            return res.status(400).json({ error: 'Type your email address exactly to confirm.' });
        }

        const result = await accountDeletion.deleteAccount(id);
        if (!result) return res.status(404).json({ error: 'Account not found' });

        // Answer first: the account is gone (or locked and being erased), and
        // a slow mail server must not turn that into an apparent failure.
        res.status(result.complete ? 200 : 202).json({ success: true, complete: result.complete });
        emailService.sendAccountDeletedEmail(result.email).catch(err => console.error('Deletion confirmation email failed:', err.message));
        emailService.sendDeletionNotice(id, result.complete).catch(err => console.error('Deletion notice email failed:', err.message));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete the account' });
    }
});

module.exports = router;
