require('dotenv').config({path: '../.env', quiet: true});
require('dotenv').config({path: '../.env.local', override: true, quiet: true});

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
// CSP violation reports, before CORS: the browser sends them on its own and
// never reads the answer, so an unexpected Origin (e.g. "null") must not
// turn them into errors. The route logs each kind once an hour.
app.use('/csp-report', require('./routes/cspReport.js'));
app.use('/client-log', require('./routes/clientLog.js'));
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
// Express 5 leaves req.body undefined when a request has no JSON body; the routes
// destructure it and rely on Express 4's {} default to answer 400 rather than 500.
app.use((req, res, next) => {
    req.body ??= {};
    next();
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Map tiles: before apiLimiter, since one map view is dozens of tiles. The
// route has its own limit.
app.use('/tiles', require('./routes/tiles.js'));

app.use(apiLimiter);

// PUBLIC ROUTES
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
app.use('/admin', auth, require('./routes/admin.js'));
app.use('/invites', require('./routes/invites'));
// Mostly protected; the router applies auth itself, after its one public route
// (signed attachment links, which a plain <a> has to be able to open).
app.use('/trips', require('./routes/trips.js'));


// EXPIRED TOKEN PURGE — on startup, then daily. find/consume already ignore
// expired tokens; this only stops them piling up. Never fatal.
const { tokenService } = require('./crudService');
const purgeExpiredTokens = async () => {
    try {
        const n = await tokenService.purgeExpired();
        if (n > 0) console.log(`Purged ${n} expired token${n === 1 ? '' : 's'}`);
    } catch (err) {
        console.error('Expired token purge failed:', err.message);
    }
};
purgeExpiredTokens();
setInterval(purgeExpiredTokens, 24 * 60 * 60 * 1000).unref();

// KEEP LISTENING ON PORTS

// Deleted accounts first: after a restore the database may hold accounts
// that were deleted later; they are anonymised again before anything is
// served. A list that cannot be read stops the API (systemd restarts it).
const accountDeletion = require('./accountDeletion');
accountDeletion.reapplyAtStartup()
    .then(() => {
        accountDeletion.scheduleReapply();
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('Re-applying account deletions failed, not starting:', err.message);
        process.exit(1);
    });