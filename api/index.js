require('dotenv').config({path: '../.env'});
require('dotenv').config({path: '../.env.local', override: true});

// index.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const app = express();
app.set('trust proxy', 1); // Nginx only. Must equal the real proxy chain depth: any higher and a client-sent X-Forwarded-For becomes req.ip, which the rate limiters key on.
const { apiLimiter } = require('./middleware/rateLimiter');
const PORT = process.env.API_PORT || process.env.PORT || 3000;
const auth = require('./middleware/auth');

const allowedOrigins = process.env.RP_ORIGIN ? process.env.RP_ORIGIN.split(',') : ['http://localhost', 'http://localhost:5173'];

app.use(helmet());
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));
app.use(express.json());

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.use(apiLimiter);

// PUBLIC ROUTE
app.use('/auth', require('./routes/auth'));

// PROTECTED ROUTES
app.use('/users', auth, require('./routes/users.js'));
app.use('/categories', auth, require('./routes/categories.js'));
app.use('/groups', auth, require('./routes/groups.js'));
app.use('/currencies', auth, require('./routes/currencies.js'));
app.use('/expenses', auth, require('./routes/expenses.js'));
app.use('/shares', auth, require('./routes/shares.js'));
app.use('/settlements', auth, require('./routes/settlements.js'));
app.use('/dash', auth, require('./routes/dash.js'));
app.use('/notifications', auth, require('./routes/notifications.js'));
app.use('/invites', require('./routes/invites'));


// KEEP LISTENING ON PORTS

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});