const router = require('express').Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const tripService = require('../tripService');
const geocodeService = require('../geocodeService');
const routeService = require('../routeService');
const uploadStore = require('../uploadStore');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const FILE_LINK_TTL = '1h';
const LAT_LON = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;
const NEAR_METRES = 300; // a stop this close to a place of the trip is that place
const MAX_LEGS = 12;
// English names for new stops: at most this many per connection, and none
// started after this long, so the request stays well inside proxy timeouts.
// The rest keep their timetable names, which the user can still edit.
const MAX_NAME_LOOKUPS = 8;
const NAME_LOOKUP_MS = 10000;

// Attachment links are signed with a key derived from JWT_SECRET, never with
// the secret itself: a link must not double as a login token, or the reverse.
const fileLinkSecret = () => `${process.env.JWT_SECRET}:trip-attachment`;
const signFileLink = id => `/trips/files/${id}?sig=${jwt.sign({ att: id }, fileLinkSecret(), { expiresIn: FILE_LINK_TTL })}`;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Local wall-clock time, as printed on the ticket: no timezone is stored.
const isValidMoment = value => DATE_OR_DATETIME.test(value) && !isNaN(new Date(value.length === 10 ? `${value}T00:00` : value));

function parseTrip(body) {
    const trip = {
        title: text(body.title, 120),
        icon: text(body.icon, 16),
        startDate: text(body.startDate, 10),
        endDate: text(body.endDate, 10),
        notes: text(body.notes, 4000),
    };
    if (!trip.title) return { error: 'A trip needs a title.' };
    if (!DATE.test(trip.startDate) || !DATE.test(trip.endDate) || !isValidMoment(trip.startDate) || !isValidMoment(trip.endDate)) {
        return { error: 'A trip needs a start and an end date.' };
    }
    if (trip.endDate < trip.startDate) return { error: 'The trip can not end before it starts.' };
    return { trip };
}

function parsePlace(ref) {
    if (!ref || typeof ref !== 'object') return null;
    if (typeof ref.id === 'string' && ref.id) return { id: ref.id };
    const name = text(ref.name, 160);
    if (!name) return null;
    const lat = Number(ref.lat), lon = Number(ref.lon);
    const located = ref.lat != null && ref.lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    return { name, address: text(ref.address, 400), lat: located ? lat : null, lon: located ? lon : null };
}

function parseItem(kind, body) {
    const item = {
        title: text(body.title, 160),
        start: text(body.start, 16),
        end: text(body.end, 16) || null,
        confirmationRef: text(body.confirmationRef, 80),
        url: text(body.url, 600),
        notes: text(body.notes, 4000),
        price: body.price === '' || body.price == null ? null : Number(body.price),
        currencyIso: text(body.currencyIso, 3),
    };
    if (!item.title) return { error: 'Give it a title.' };
    if (!isValidMoment(item.start)) return { error: 'A start date is required.' };
    if (item.end && !isValidMoment(item.end)) return { error: 'The end date is not valid.' };
    if (item.end && item.end.slice(0, 10) < item.start.slice(0, 10)) return { error: 'It can not end before it starts.' };
    if (item.end && item.end.length === 16 && item.start.length === 16 && item.end < item.start) return { error: 'It can not end before it starts.' };
    if (item.url && !/^https?:\/\//i.test(item.url)) return { error: 'The link has to start with http:// or https://.' };
    if (item.price != null && (!Number.isInteger(item.price) || item.price < 0)) return { error: 'The price is not valid.' };
    if (item.price != null && !item.currencyIso) return { error: 'A price needs a currency.' };

    if (kind === 'transport') {
        item.mode = text(body.mode, 16);
        item.carrier = text(body.carrier, 80);
        item.number = text(body.number, 40);
        item.from = parsePlace(body.from);
        item.to = parsePlace(body.to);
        if (!tripService.TRANSPORT_MODES.includes(item.mode)) return { error: 'Pick a kind of transport.' };
    } else {
        item.place = parsePlace(body.place);
    }
    return { item };
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadStore.MAX_BYTES, files: 1 },
}).single('file');

// Nominatim is a shared, donated service; keep one user from hammering it.
const geocodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    message: { error: 'Too many place searches, please wait a moment.' },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

// Transitous is run by volunteers, and a route search costs it far more than
// a place search costs Nominatim. Counted per user: they are all logged in.
const routeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    keyGenerator: req => req.user.id,
    message: { error: 'Too many route searches, please wait a moment.' },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

// One end of a route search: a place of the trip (by id) or 'lat,lon'.
function parseRouteEnd(value, places, label) {
    const raw = text(value, 80).replace(/\s+/g, '');
    const m = LAT_LON.exec(raw);
    if (m) {
        const lat = Number(m[1]), lon = Number(m[2]);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: `The ${label} position is not valid.` };
        return { end: { lat, lon } };
    }
    const place = raw && places.find(p => p.id === raw);
    if (!place) return { error: `Pick where to ${label === 'start' ? 'leave from' : 'go to'}.` };
    if (place.lat == null || place.lon == null) {
        return { error: `${place.name} is not on the map, so there is nothing to search a route from. Search the place again to give it a position.` };
    }
    return { end: { lat: place.lat, lon: place.lon } };
}

function parseStop(stop) {
    const name = text(stop?.name, 160);
    const lat = Number(stop?.lat), lon = Number(stop?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { name, lat, lon };
}

// ── PUBLIC: download an attachment through a signed link ──
// A link, not the bearer token, because a file has to open with a plain <a>:
// the browser's own PDF and image viewers can not send an Authorization header.
router.get('/files/:id', async (req, res) => {
    try {
        let claim;
        try {
            claim = jwt.verify(String(req.query.sig || ''), fileLinkSecret());
        } catch {
            return res.status(403).json({ error: 'This link has expired. Reopen the item and try again.' });
        }
        if (claim.att !== req.params.id) return res.status(403).json({ error: 'Invalid link' });

        const attachment = await tripService.getAttachmentById(req.params.id);
        if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

        res.set({
            'Content-Type': attachment.mimeType,
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
            'Cache-Control': 'private, max-age=3600',
        });
        res.sendFile(uploadStore.filePath(attachment.storedName), err => {
            if (err && !res.headersSent) res.status(404).json({ error: 'Attachment file is missing' });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Everything below needs a logged-in user.
router.use(require('../middleware/auth'));

// GEOCODE
router.get('/geocode', geocodeLimiter, async (req, res) => {
    try {
        const q = text(req.query.q, 200);
        if (q.length < 3) return res.status(400).json({ error: 'Type at least 3 characters to search.' });
        res.json({ success: true, results: await geocodeService.search(q) });
    } catch (error) {
        if (error.busy) return res.status(503).json({ error: 'Place search is busy. Try again in a few seconds.' });
        console.error(error);
        res.status(502).json({ error: 'Place search is not available right now.' });
    }
});

// ── ITEMS ── (declared before /:id so "items" is never read as a trip id)

// READ ONE
router.get('/items/:itemId', async (req, res) => {
    try {
        const result = await tripService.getItemById(req.params.itemId, req.user.id);
        if (!result.success) return res.status(404).json(result);
        result.item.attachments = result.item.attachments.map(({ storedName, ...a }) => ({ ...a, url: signFileLink(a.id) }));
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE
router.put('/items/:itemId', async (req, res) => {
    try {
        const existing = await tripService.getItemById(req.params.itemId, req.user.id);
        if (!existing.success) return res.status(404).json(existing);
        const { item, error } = parseItem(existing.item.kind, req.body);
        if (error) return res.status(400).json({ error });
        const result = await tripService.updateItem(req.params.itemId, req.user.id, item);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// RESCHEDULE — start and end only (dragging a bar on the timeline). Same date
// rules as the full form; everything else about the item is left alone.
router.patch('/items/:itemId/when', async (req, res) => {
    try {
        const start = text(req.body.start, 16);
        const end = text(req.body.end, 16) || null;
        if (!isValidMoment(start)) return res.status(400).json({ error: 'A start date is required.' });
        if (end && !isValidMoment(end)) return res.status(400).json({ error: 'The end date is not valid.' });
        if (end && end.slice(0, 10) < start.slice(0, 10)) return res.status(400).json({ error: 'It can not end before it starts.' });
        if (end && end.length === 16 && start.length === 16 && end < start) return res.status(400).json({ error: 'It can not end before it starts.' });
        const result = await tripService.rescheduleItem(req.params.itemId, req.user.id, { start, end });
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE
router.delete('/items/:itemId', async (req, res) => {
    try {
        const { storedNames, ...result } = await tripService.deleteItem(req.params.itemId, req.user.id);
        if (!result.success) return res.status(404).json(result);
        await uploadStore.remove(storedNames);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// LINK / UNLINK EXPENSE
router.post('/items/:itemId/expenses', async (req, res) => {
    try {
        const result = await tripService.linkExpense(req.params.itemId, String(req.body.expenseId || ''), req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/items/:itemId/expenses/:expenseId', async (req, res) => {
    try {
        const result = await tripService.unlinkExpense(req.params.itemId, req.params.expenseId, req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPLOAD ATTACHMENT
router.post('/items/:itemId/attachments', (req, res) => {
    upload(req, res, async uploadError => {
        try {
            if (uploadError) {
                const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
                return res.status(tooBig ? 413 : 400).json({
                    error: tooBig ? `The file is larger than ${uploadStore.MAX_BYTES / 1024 / 1024} MB.` : 'Upload failed.',
                });
            }
            if (!req.file) return res.status(400).json({ error: 'No file was sent.' });
            if (!uploadStore.isAllowed(req.file.mimetype, req.file.buffer)) {
                return res.status(415).json({ error: 'Only PDF, JPEG, PNG and WebP files can be attached.' });
            }

            const { itemId } = req.params;
            const item = await tripService.getItemById(itemId, req.user.id);
            if (!item.success) return res.status(404).json(item);
            if (await tripService.countAttachments(itemId) >= uploadStore.MAX_PER_ITEM) {
                return res.status(400).json({ error: `An item can have at most ${uploadStore.MAX_PER_ITEM} attachments.` });
            }

            // Multipart filenames arrive as latin1 bytes; turn them back into
            // UTF-8 and drop anything that is not part of a plain file name.
            const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
                .replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 150) || 'attachment';

            const storedName = await uploadStore.save(req.file.buffer);
            const result = await tripService.createAttachment(itemId, req.user.id, {
                filename, mimeType: req.file.mimetype, size: req.file.size, storedName,
            });
            if (!result.success) {
                await uploadStore.remove([storedName]);
                return res.status(404).json(result);
            }
            res.status(201).json(result);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
        }
    });
});

// DELETE ATTACHMENT
router.delete('/attachments/:id', async (req, res) => {
    try {
        const { storedNames, ...result } = await tripService.deleteAttachment(req.params.id, req.user.id);
        if (!result.success) return res.status(404).json(result);
        await uploadStore.remove(storedNames);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE PLACE
router.put('/places/:placeId', async (req, res) => {
    try {
        const place = parsePlace({ ...req.body, id: undefined });
        if (!place) return res.status(400).json({ error: 'A place needs a name.' });
        const result = await tripService.updatePlace(req.params.placeId, req.user.id, place);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ── TRIPS ──

// CREATE
router.post('/', async (req, res) => {
    try {
        const { trip, error } = parseTrip(req.body);
        if (error) return res.status(400).json({ error });
        const result = await tripService.createTrip(String(req.body.groupId || ''), req.user.id, trip);
        if (!result.success) return res.status(404).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ALL (?groupId= narrows it to one group)
router.get('/', async (req, res) => {
    try {
        const result = await tripService.getTrips(req.user.id, req.query.groupId ? String(req.query.groupId) : null);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ONE
router.get('/:id', async (req, res) => {
    try {
        const result = await tripService.getTripById(req.params.id, req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const { trip, error } = parseTrip(req.body);
        if (error) return res.status(400).json({ error });
        const result = await tripService.updateTrip(req.params.id, req.user.id, trip);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE
router.delete('/:id', async (req, res) => {
    try {
        const { storedNames, ...result } = await tripService.deleteTrip(req.params.id, req.user.id);
        if (!result.success) return res.status(404).json(result);
        await uploadStore.remove(storedNames);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// CREATE ITEM
router.post('/:id/items', async (req, res) => {
    try {
        const kind = String(req.body.kind || '');
        if (!tripService.KIND_LABELS[kind]) return res.status(400).json({ error: 'Unknown kind of item.' });
        const { item, error } = parseItem(kind, req.body);
        if (error) return res.status(400).json({ error });
        const result = await tripService.createItem(req.params.id, req.user.id, kind, item);
        if (!result.success) return res.status(404).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ── ROUTE PLANNER ── public-transport connections, added as transport items

// SEARCH — ?from= &to= (a place id or 'lat,lon'), &when= (local time at the
// origin, or at the destination with &arriveBy=1), &modes= (all|rail|bus),
// &cursor= (earlier or later connections than a previous answer; with &wide=1
// when that answer was widened to stops further away).
router.get('/:id/routes', routeLimiter, async (req, res) => {
    try {
        const places = await tripService.getPlaces(req.params.id, req.user.id);
        if (!places) return res.status(404).json({ error: 'Trip not found or access denied' });

        const from = parseRouteEnd(req.query.from, places, 'start');
        if (from.error) return res.status(400).json({ error: from.error });
        const to = parseRouteEnd(req.query.to, places, 'destination');
        if (to.error) return res.status(400).json({ error: to.error });
        if (geocodeService.metresBetween(from.end, to.end) < 100) {
            return res.status(400).json({ error: 'Where you leave from and where you go to are the same place.' });
        }
        const when = text(req.query.when, 16);
        if (when.length !== 16 || !isValidMoment(when)) return res.status(400).json({ error: 'Pick a date and a time.' });
        const modes = text(req.query.modes, 8) || 'all';
        if (!Object.hasOwn(routeService.MODE_FILTERS, modes)) return res.status(400).json({ error: 'Unknown kind of transport.' });
        const cursor = text(req.query.cursor, 200);
        if (cursor && !/^[\w|:=+/-]+$/.test(cursor)) return res.status(400).json({ error: 'Invalid page.' });

        const arriveBy = req.query.arriveBy === '1' || req.query.arriveBy === 'true';
        const wide = req.query.wide === '1';
        const result = await routeService.search({ from: from.end, to: to.end, when, arriveBy, modes, cursor, wide });
        res.json({ success: true, ...result });
    } catch (error) {
        if (error instanceof routeService.RouteError) return res.status(error.status).json({ error: error.message });
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// PLACES FOR A CONNECTION — the stops of a chosen connection, matched to the
// trip's places: a stop within NEAR_METRES of one is that place, and stops that
// close to each other (the platform you arrive at and the bus stop outside)
// become one new place. A new place whose timetable name is not in Latin
// script gets the English name of that station from OpenStreetMap when one is
// found. Answers { places: [{key, id?, name, originalName, lat, lon}], keys }
// with one key per stop, in the order sent.
router.post('/:id/routes/places', routeLimiter, async (req, res) => {
    try {
        const places = await tripService.getPlaces(req.params.id, req.user.id);
        if (!places) return res.status(404).json({ error: 'Trip not found or access denied' });

        const raw = Array.isArray(req.body.stops) ? req.body.stops : [];
        if (raw.length === 0 || raw.length > MAX_LEGS * 2) return res.status(400).json({ error: 'No stops to look up.' });
        const stops = raw.map(parseStop);
        if (stops.some(s => !s)) return res.status(400).json({ error: 'A stop is not valid.' });

        const located = places.filter(p => p.lat != null && p.lon != null);
        const nearest = (list, stop) => list
            .map(p => ({ p, d: geocodeService.metresBetween(stop, p) }))
            .filter(x => x.d <= NEAR_METRES)
            .sort((a, b) => a.d - b.d)[0]?.p;

        // Whichever is closest wins, a place of the trip or a stop already seen:
        // the bus stop outside a station joins the station, not a hotel a bit further.
        const proposals = [];
        const keys = stops.map(stop => {
            const near = nearest([...located.map(p => ({ ...p, key: `place:${p.id}` })), ...proposals], stop);
            if (near?.id) {
                if (!proposals.some(p => p.key === near.key)) {
                    proposals.push({ key: near.key, id: near.id, name: near.name, originalName: near.name, lat: near.lat, lon: near.lon });
                }
                return near.key;
            }
            if (near) return near.key;
            const proposal = { key: `new:${proposals.length}`, name: stop.name, originalName: stop.name, lat: stop.lat, lon: stop.lon };
            proposals.push(proposal);
            return proposal.key;
        });

        const deadline = Date.now() + NAME_LOOKUP_MS;
        for (const p of proposals.filter(p => !p.id).slice(0, MAX_NAME_LOOKUPS)) {
            const left = deadline - Date.now();
            if (left <= 0) break;
            try {
                // A lookup still running at the deadline finishes in the
                // background and only fills the cache.
                const name = await Promise.race([
                    geocodeService.englishStopName(p.originalName, p.lat, p.lon),
                    new Promise(resolve => setTimeout(resolve, left, null)),
                ]);
                p.name = name || p.name;
            } catch (err) {
                // Nominatim being away or busy only costs the English name.
                console.error(`English stop name lookup failed: ${err.message}`);
            }
        }
        res.json({ success: true, places: proposals, keys });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ADD A CONNECTION — its chosen legs as transport items, in one transaction:
// a journey is added whole or not at all. Body: { places: [{key, id} or
// {key, name, address, lat, lon}], legs: [{fromKey, toKey, title, mode,
// carrier, number, start, end, notes}] }. Legs naming the same key share one place.
router.post('/:id/routes', async (req, res) => {
    try {
        const legs = Array.isArray(req.body.legs) ? req.body.legs : [];
        if (legs.length === 0) return res.status(400).json({ error: 'Pick at least one leg to add.' });
        if (legs.length > MAX_LEGS) return res.status(400).json({ error: `At most ${MAX_LEGS} legs can be added at once.` });

        const refs = new Map();
        for (const p of (Array.isArray(req.body.places) ? req.body.places : []).slice(0, MAX_LEGS * 2)) {
            const key = text(p?.key, 40);
            const ref = parsePlace(p);
            if (key && ref) refs.set(key, ref);
        }

        const items = [];
        for (const leg of legs) {
            const { item, error } = parseItem('transport', { ...leg, from: null, to: null, price: null });
            if (error) return res.status(400).json({ error: `${text(leg?.title, 160) || 'A leg'}: ${error}` });
            item.from = refs.get(text(leg.fromKey, 40)) ?? null;
            item.to = refs.get(text(leg.toKey, 40)) ?? null;
            items.push(item);
        }

        const result = await tripService.createItems(req.params.id, req.user.id, 'transport', items);
        if (!result.success) return res.status(404).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
