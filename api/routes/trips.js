const router = require('express').Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const tripService = require('../tripService');
const geocodeService = require('../geocodeService');
const uploadStore = require('../uploadStore');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const FILE_LINK_TTL = '1h';

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

module.exports = router;
