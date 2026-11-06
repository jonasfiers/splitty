const jwt = require('jsonwebtoken');
const { isDeleted } = require('../accountDeletion');

module.exports = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        // A token issued before the account was deleted stops working at once.
        if (isDeleted(req.user.id)) return res.status(401).json({ error: 'This account has been deleted' });
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
};