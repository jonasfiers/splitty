const router = require('express').Router();
const { userServiceNeo4j } = require('../crudService');
const requireAdmin = require('../middleware/requireAdmin');

// Mounted behind the auth middleware. Admin-only routes use middleware/requireAdmin.

// Whether the signed-in user is an admin. Open to every signed-in user: the
// app uses it only to decide what to show; the server enforces the role on
// each admin route itself.
router.get('/me', async (req, res) => {
    try {
        const role = await userServiceNeo4j.getRole(req.user.id);
        res.json({ isAdmin: role === 'admin' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to read role' });
    }
});

// ADMINS — who has the admin role, granting and revoking it. Admins only.
// The role is read from the database on every admin request, so a change
// works at once, also for someone who is signed in.
router.get('/admins', requireAdmin, async (req, res) => {
    try {
        const admins = await userServiceNeo4j.listAdmins();
        res.json({ admins: admins.map(a => ({ ...a, you: a.id === req.user.id })) });
    } catch (error) {
        console.error('[admin] list admins:', error);
        res.status(500).json({ error: 'Failed to load admins' });
    }
});

router.post('/admins', requireAdmin, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) return res.status(400).json({ error: 'Enter the email address of their account.' });
    try {
        const result = await userServiceNeo4j.grantAdmin(email);
        if (result.error === 'not_found') return res.status(404).json({ error: 'No account uses that email address.' });
        if (result.error === 'unverified') return res.status(409).json({ error: 'That account has not verified its email address yet.' });
        if (result.error === 'already') return res.status(409).json({ error: `${result.user.name} is already an admin.` });
        console.log(`[admin] ${req.user.id} granted admin to ${result.user.id}`);
        res.status(201).json({ success: true, admin: { id: result.user.id, name: result.user.name, email, you: false } });
    } catch (error) {
        console.error('[admin] grant:', error);
        res.status(500).json({ error: 'Failed to grant the admin role' });
    }
});

router.delete('/admins/:id', requireAdmin, async (req, res) => {
    try {
        const result = await userServiceNeo4j.revokeAdmin(req.params.id);
        if (result.error === 'not_admin') return res.status(404).json({ error: 'That user is not an admin.' });
        if (result.error === 'last_admin') return res.status(409).json({ error: 'Splitty needs at least one admin.' });
        console.log(`[admin] ${req.user.id} revoked admin from ${req.params.id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('[admin] revoke:', error);
        res.status(500).json({ error: 'Failed to revoke the admin role' });
    }
});

module.exports = router;
