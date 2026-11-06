const router = require('express').Router();
const { userServiceNeo4j } = require('../crudService');

// Mounted behind the auth middleware. Admin-only routes added here later
// (e.g. granting or revoking roles) must use middleware/requireAdmin.

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

module.exports = router;
