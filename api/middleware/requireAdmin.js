const { userServiceNeo4j } = require('../crudService');

// Use after the auth middleware. Lets the request through only if the user's
// role in the database is 'admin' right now; the JWT is not trusted for this,
// so revoking the role takes effect immediately rather than at token expiry.
module.exports = async (req, res, next) => {
    try {
        const role = await userServiceNeo4j.getRole(req.user?.id);
        if (role === 'admin') return next();
        return res.status(403).json({ error: 'Admins only' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to check permissions' });
    }
};
