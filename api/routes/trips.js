const router = require('express').Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const tripService = require('../tripService');
const geocodeService = require('../geocodeService');
const routeService = require('../routeService');
const uploadStore = require('../uploadStore');
const fileUpload = require('../fileUpload');
const tripPhotos = require('../tripPhotos');
const stopNames = require('../stopNames');
const placeAddresses = require('../placeAddresses');
const { Readable } = require('stream');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_OR_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const LAT_LON = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/;
const NEAR_METRES = 300; // a stop this close to a place of the trip is that place
const MAX_LEGS = 12;
// English names for new stops: at most this many per connection, and none
// started after this long, so the request stays well inside proxy timeouts.
// The rest keep their timetable names, which the user can still edit.
const MAX_NAME_LOOKUPS = 8;
const NAME_LOOKUP_MS = 10000;

// Signed file links (5 minutes): fileLinks.js.
const { verifyFileLink, withFileLinks } = require('../fileLinks');

// Photo links (tripPhotos.js): one signature per album per day, so the
// browser's cache keeps the thumbnails all day. Valid two days, so a page
// opened before midnight keeps working. Own derived key, as above.
const photoLinkSecret = () => `${process.env.JWT_SECRET}:trip-photo`;
const photoSig = albumId => {
    const day = Math.floor(Date.now() / 86_400_000) * 86_400;
    return jwt.sign({ alb: albumId, iat: day, exp: day + 2 * 86_400 }, photoLinkSecret());
};

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Local wall-clock time, as printed on the ticket: no timezone is stored.
const isValidMoment = value => DATE_OR_DATETIME.test(value) && !isNaN(new Date(value.length === 10 ? `${value}T00:00` : value));

function parseTrip(body) {
    const trip = {
        title: text(body.title, 120),
        icon: text(body.icon, 40), // an icon's name (web/src/utils/icons.js)
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

// The codes printed on the item's tickets (tripService: ticketsOf), each as
// the text it holds, so the app can draw them again full screen. Codes are not
// trimmed: fixed-width payloads such as an airline boarding pass (BCBP) pad
// fields with spaces. A client from before the list (one ticketCode) is still
// understood.
const TICKET_FORMATS = ['qr', 'aztec', 'pdf417', 'datamatrix', 'code128'];
const MAX_TICKETS = 10;
function parseTickets(body) {
    const list = Array.isArray(body.tickets) ? body.tickets
        : typeof body.ticketCode === 'string' ? [{ code: body.ticketCode, format: body.ticketFormat }] : [];
    return list
        .filter(t => t && typeof t.code === 'string' && t.code.trim())
        .slice(0, MAX_TICKETS)
        .map(t => ({
            code: t.code.slice(0, 2000),
            format: TICKET_FORMATS.includes(t.format) ? t.format : 'qr',
            name: text(t.name, 40),
        }));
}

function parseItem(kind, body) {
    const item = {
        title: text(body.title, 160),
        start: text(body.start, 16),
        end: text(body.end, 16) || null,
        confirmationRef: text(body.confirmationRef, 80),
        tickets: parseTickets(body),
        url: text(body.url, 600),
        notes: text(body.notes, 4000),
    };
    if (!item.title) return { error: 'Give it a title.' };
    if (!isValidMoment(item.start)) return { error: 'A start date is required.' };
    if (item.end && !isValidMoment(item.end)) return { error: 'The end date is not valid.' };
    if (item.end && item.end.slice(0, 10) < item.start.slice(0, 10)) return { error: 'It can not end before it starts.' };
    if (item.end && item.end.length === 16 && item.start.length === 16 && item.end < item.start) return { error: 'It can not end before it starts.' };
    if (item.url && !/^https?:\/\//i.test(item.url)) return { error: 'The link has to start with http:// or https://.' };

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


// Nominatim is a shared, donated service; keep one user from hammering it.
// Searches go out as the user types (a pause between keystrokes), so a few
// per place picked. Counted per user: they are all logged in.
const geocodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    keyGenerator: req => req.user.id,
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

// Matching a chosen connection's stops to the trip's places costs Transitous
// nothing and Nominatim at most a few bounded lookups, so it has its own,
// looser limit: a run of searches must not leave the confirm step unmatched.
const routePlacesLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: req => req.user.id,
    message: { error: 'Too many stop lookups, please wait a moment.' },
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

// ── PUBLIC: download a file through a signed link (fileLinks.js) ──
// Trip attachments, trip documents and expense receipts alike; /thumb gives
// a receipt's small preview (404 when it has none: show the file instead).
router.get(['/files/:id', '/files/:id/thumb'], async (req, res) => {
    try {
        const signedFor = verifyFileLink(req.query.sig);
        if (!signedFor) return res.status(403).json({ error: 'This link has expired. Reopen the page and try again.' });
        if (signedFor !== req.params.id) return res.status(403).json({ error: 'Invalid link' });

        const attachment = await tripService.getAttachmentById(req.params.id);
        if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

        if (req.path.endsWith('/thumb')) {
            if (!attachment.thumbStoredName) return res.status(404).json({ error: 'No preview' });
            res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' });
            return res.sendFile(uploadStore.filePath(attachment.thumbStoredName), err => {
                if (err && !res.headersSent) res.status(404).json({ error: 'Preview is missing' });
            });
        }

        res.set({
            'Content-Type': attachment.mimeType,
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
            'Cache-Control': 'private, max-age=300',
        });
        res.sendFile(uploadStore.filePath(attachment.storedName), err => {
            if (err && !res.headersSent) res.status(404).json({ error: 'Attachment file is missing' });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ── PUBLIC: a photo of a trip's Immich album, through a signed link ──
router.get('/photos/:albumId/:assetId/:size', async (req, res, next) => {
    const { albumId, assetId, size } = req.params;
    if (!['thumbnail', 'preview'].includes(size)) return next(); // video: below
    try {
        const claim = jwt.verify(String(req.query.sig || ''), photoLinkSecret());
        if (claim.alb !== albumId) return res.status(403).end();
    } catch {
        return res.status(403).json({ error: 'This link has expired. Reload the trip.' });
    }
    try {
        const album = await tripPhotos.albumForThumbnail(albumId);
        if (!album) return res.status(404).end();
        const upstream = await tripPhotos.thumbnail(album, assetId, size);
        const type = upstream.headers.get('content-type') || '';
        if (!type.startsWith('image/')) return res.status(502).end();
        res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        const len = upstream.headers.get('content-length');
        if (len) res.set('Content-Length', len);
        Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
        if (err instanceof tripPhotos.PhotoError) return res.status(err.status).end();
        console.error('[photos] thumbnail:', err);
        res.status(500).end();
    }
});

// ── PUBLIC: a video of a trip's album, same signed link, streamed ──
router.get('/photos/:albumId/:assetId/video', async (req, res) => {
    const { albumId, assetId } = req.params;
    try {
        const claim = jwt.verify(String(req.query.sig || ''), photoLinkSecret());
        if (claim.alb !== albumId) return res.status(403).end();
    } catch {
        return res.status(403).end();
    }
    try {
        const album = await tripPhotos.albumForThumbnail(albumId);
        if (!album) return res.status(404).end();
        await tripPhotos.streamVideo(album, assetId, req, res, 'private, max-age=86400');
    } catch (err) {
        if (res.headersSent) return res.destroy();
        if (err instanceof tripPhotos.PhotoError) return res.status(err.status).end();
        console.error('[photos] video:', err);
        res.status(500).end();
    }
});

// Everything below needs a logged-in user.
router.use(require('../middleware/auth'));

// A preview for a file that has none yet (tripService.setPreviewIfMissing):
// multipart with only `thumbnail`.
router.post('/files/:id/thumb', async (req, res) => {
    const got = await fileUpload.receive(req, res, { fileRequired: false });
    if (!got) return;
    if (!got.thumb) return res.status(400).json({ error: 'No preview was sent.' });
    try {
        const thumbStoredName = await uploadStore.save(got.thumb.buffer);
        const outcome = await tripService.setPreviewIfMissing(req.params.id, req.user.id, thumbStoredName);
        if (outcome === 'set') return res.status(201).json({ success: true });
        await uploadStore.remove([thumbStoredName]);
        if (outcome === 'exists') return res.status(409).json({ error: 'This file already has a preview.' });
        res.status(404).json({ error: 'File not found' });
    } catch (error) {
        fileUpload.failed(res, error);
    }
});

// ── Photos: Immich albums linked to a trip (tripPhotos.js) ──
const photoError = (res, err, where) => {
    if (err instanceof tripPhotos.PhotoError) return res.status(err.status).json({ error: err.message });
    console.error(`[photos] ${where}:`, err);
    res.status(500).json({ error: 'Something went wrong with the photos.' });
};

router.get('/:id/photos', async (req, res) => {
    if (!tripPhotos.enabled()) return res.json({ enabled: false, albums: [], photos: [] });
    try {
        const result = await tripPhotos.tripPhotos(req.params.id, req.user.id);
        if (!result) return res.status(404).json({ error: 'Trip not found' });
        const sigs = new Map(result.albums.map(a => [a.id, photoSig(a.id)]));
        res.json({
            enabled: true,
            albums: result.albums,
            photos: result.photos.map(p => ({
                ...p,
                thumb: `/trips/photos/${p.album}/${p.id}/thumbnail?sig=${sigs.get(p.album)}`,
                preview: `/trips/photos/${p.album}/${p.id}/preview?sig=${sigs.get(p.album)}`,
                ...(p.video ? { play: `/trips/photos/${p.album}/${p.id}/video?sig=${sigs.get(p.album)}` } : {}),
            })),
        });
    } catch (err) { photoError(res, err, 'list'); }
});

router.post('/:id/albums', async (req, res) => {
    if (!tripPhotos.enabled()) return res.status(503).json({ error: 'Photos are not set up on this server.' });
    try {
        const album = await tripPhotos.addAlbum(req.params.id, req.user.id, req.body?.url);
        console.log(`[photos] album ${album.id} added to trip ${req.params.id} by ${req.user.id}`);
        res.status(201).json({ album });
    } catch (err) { photoError(res, err, 'add'); }
});

// ── Follow-my-trip links (followService.js) ──
const followService = require('../followService');
router.get('/:id/follow-links', async (req, res) => {
    try {
        const links = await followService.listLinks(req.params.id, req.user.id);
        if (!links) return res.status(404).json({ error: 'Trip not found' });
        // How many photos "all" and "favourites" would show, for the sheet.
        res.json({ links, photoCounts: await followService.photoCounts(req.params.id, req.user.id) });
    } catch (err) { console.error('[follow] list:', err); res.status(500).json({ error: 'Failed to load the links.' }); }
});
router.post('/:id/follow-links', async (req, res) => {
    try {
        // photos: 'all' | 'favourites' | 'none' (true/false from older apps).
        const photos = req.body?.photos === undefined ? 'all' : req.body.photos;
        const link = await followService.createLink(req.params.id, req.user.id, { photos, keep: req.body?.keep === true });
        if (!link) return res.status(404).json({ error: 'Trip not found' });
        console.log(`[follow] link created for trip ${req.params.id} by ${req.user.id}`);
        res.status(201).json({ link });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error('[follow] create:', err); res.status(500).json({ error: 'Failed to create the link.' });
    }
});
router.patch('/:id/follow-links/:token', async (req, res) => {
    try {
        const { photos, keep } = req.body || {};
        if (photos !== undefined && ![true, false, 'all', 'favourites', 'none'].includes(photos)) return res.status(400).json({ error: 'photos must be all, favourites or none.' });
        if (keep !== undefined && typeof keep !== 'boolean') return res.status(400).json({ error: 'keep must be true or false.' });
        if (!(await followService.updateLink(req.params.id, req.user.id, req.params.token, { photos, keep }))) return res.status(404).json({ error: 'Link not found' });
        console.log(`[follow] link changed on trip ${req.params.id} by ${req.user.id}`);
        res.json({ success: true });
    } catch (err) { console.error('[follow] change:', err); res.status(500).json({ error: 'Failed to change the link.' }); }
});
router.delete('/:id/follow-links/:token', async (req, res) => {
    try {
        if (!(await followService.removeLink(req.params.id, req.user.id, req.params.token))) return res.status(404).json({ error: 'Link not found' });
        console.log(`[follow] link removed from trip ${req.params.id} by ${req.user.id}`);
        res.json({ success: true });
    } catch (err) { console.error('[follow] remove:', err); res.status(500).json({ error: 'Failed to remove the link.' }); }
});

router.delete('/:id/albums/:albumId', async (req, res) => {
    try {
        if (!(await tripPhotos.removeAlbum(req.params.id, req.user.id, req.params.albumId))) return res.status(404).json({ error: 'Album not found' });
        res.json({ success: true });
    } catch (err) { photoError(res, err, 'remove'); }
});

// GEOCODE
router.get('/geocode', geocodeLimiter, async (req, res) => {
    try {
        const q = text(req.query.q, 200);
        if (q.length < 3) return res.status(400).json({ error: 'Type at least 3 characters to search.' });
        // `near`: the trip's area, to rank places there first. `transit`: the
        // route finder, stations first. `typing`: sent while typing (no
        // Nominatim fallback, its policy forbids autocomplete).
        const near = LAT_LON.exec(text(req.query.near, 40));
        const options = {
            near: near ? { lat: Number(near[1]), lon: Number(near[2]) } : null,
            transit: req.query.transit === '1',
            typing: req.query.typing === '1',
        };
        res.json({ success: true, results: await geocodeService.search(q, options) });
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
        result.item.attachments = withFileLinks(result.item.attachments);
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
        // The kind can be changed too (a stay that was entered as an activity).
        const kind = tripService.KIND_LABELS[req.body.kind] ? req.body.kind : existing.item.kind;
        const { item, error } = parseItem(kind, req.body);
        if (error) return res.status(400).json({ error });
        const result = await tripService.updateItem(req.params.itemId, req.user.id, item, kind);
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

// ADD TICKETS — {tickets: [{code, format, name}]} appended to the item's own
// (a ticket shared into Splitty); the rest of the item is left alone.
router.post('/items/:itemId/tickets', async (req, res) => {
    try {
        const tickets = parseTickets({ tickets: req.body.tickets });
        if (!tickets.length) return res.status(400).json({ error: 'No ticket codes given.' });
        const result = await tripService.addTickets(req.params.itemId, req.user.id, tickets, MAX_TICKETS);
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
        if (!result.success) return res.status(result.status || 404).json(result);
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
router.post('/items/:itemId/attachments', async (req, res) => {
    const got = await fileUpload.receive(req, res);
    if (!got) return;
    const { file, thumb } = got;
    try {
        const { itemId } = req.params;
        const item = await tripService.getItemById(itemId, req.user.id);
        if (!item.success) return res.status(404).json(item);
        if (await tripService.countAttachments(itemId) >= uploadStore.MAX_PER_ITEM) {
            return res.status(400).json({ error: `An item can have at most ${uploadStore.MAX_PER_ITEM} attachments.` });
        }
        const names = await fileUpload.save(file, thumb);
        const result = await tripService.createAttachment(itemId, req.user.id, {
            filename: uploadStore.cleanFilename(file.originalname, 'attachment'),
            mimeType: file.mimetype, size: file.size, ...names,
        });
        if (!result.success) {
            await uploadStore.remove([names.storedName, names.thumbStoredName]);
            return res.status(404).json(result);
        }
        res.status(201).json(result);
    } catch (error) {
        fileUpload.failed(res, error);
    }
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

// ── DOCUMENTS ── a trip's travel documents (tripService, "DOCUMENTS"):
// private to the uploader unless shared with the trip.
const MAX_DOCUMENTS = 30; // per person per trip

const withLinks = withFileLinks;

router.get('/:id/documents', async (req, res) => {
    try {
        const trip = await tripService.getTripById(req.params.id, req.user.id);
        if (!trip.success) return res.status(404).json(trip);
        res.json({ success: true, documents: withLinks(await tripService.listDocuments(req.params.id, req.user.id)) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// multipart: file, and shared ("true" to share with the trip; private otherwise)
router.post('/:id/documents', async (req, res) => {
    const got = await fileUpload.receive(req, res);
    if (!got) return;
    const { file, thumb } = got;
    try {
        const tripId = req.params.id;
        const trip = await tripService.getTripById(tripId, req.user.id);
        if (!trip.success) return res.status(404).json(trip);
        if (await tripService.countOwnDocuments(tripId, req.user.id) >= MAX_DOCUMENTS) {
            return res.status(400).json({ error: `You can add at most ${MAX_DOCUMENTS} documents to a trip.` });
        }
        const names = await fileUpload.save(file, thumb);
        const result = await tripService.createDocument(tripId, req.user.id, {
            filename: uploadStore.cleanFilename(file.originalname, 'document'),
            mimeType: file.mimetype, size: file.size, ...names,
            shared: req.body?.shared === 'true',
        });
        if (!result.success) {
            await uploadStore.remove([names.storedName, names.thumbStoredName]);
            return res.status(404).json(result);
        }
        res.status(201).json(result);
    } catch (error) {
        fileUpload.failed(res, error);
    }
});

// {ids: [...]} -> {ids: [...]}: those still visible to this user, for the
// copies kept on a phone (utils/offlineDocs.js). Ids only, nothing else.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.post('/documents/visible', async (req, res) => {
    try {
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || ids.length > 500 || !ids.every(id => typeof id === 'string' && UUID.test(id))) {
            return res.status(400).json({ error: 'ids must be a list of document ids.' });
        }
        res.json({ success: true, ids: ids.length ? await tripService.visibleDocumentIds(ids, req.user.id) : [] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// {shared: true|false}
router.patch('/documents/:docId', async (req, res) => {
    try {
        if (typeof req.body?.shared !== 'boolean') return res.status(400).json({ error: 'shared must be true or false.' });
        const result = await tripService.setDocumentShared(req.params.docId, req.user.id, req.body.shared);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/documents/:docId', async (req, res) => {
    try {
        const { storedNames, ...result } = await tripService.deleteDocument(req.params.docId, req.user.id);
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

// OFFLINE COPY — ?today=YYYY-MM-DD (the user's date): the trips a phone keeps
// for reading without a connection (tripService.getOfflineTrips). Trips that
// ended up to 3 days before today stay in it (the way home).
router.get('/offline', async (req, res) => {
    try {
        const { today } = req.query;
        const day = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) && !isNaN(Date.parse(today))
            ? new Date(`${today}T00:00:00Z`) : new Date();
        day.setUTCDate(day.getUTCDate() - 3);
        const result = await tripService.getOfflineTrips(req.user.id, day.toISOString().slice(0, 10));
        // Links to fetch the files with (signed for FILE_LINK_TTL).
        for (const t of result.trips) {
            t.documents = withLinks(t.documents);
            for (const item of t.items) item.attachments = withFileLinks(item.attachments);
        }
        res.json(result);
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

// DUPLICATE — {title} names the copy
router.post('/:id/copy', async (req, res) => {
    try {
        const title = text(req.body.title, 120);
        if (!title) return res.status(400).json({ error: 'A trip needs a title.' });
        const result = await tripService.duplicateTrip(req.params.id, req.user.id, title);
        if (!result.success) return res.status(404).json(result);
        res.status(201).json(result);
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
        // A copy: the search is cached, the names in it change as they're learned.
        const result = structuredClone(await routeService.search({ from: from.end, to: to.end, when, arriveBy, modes, cursor, wide }));
        let pendingNames = 0;
        try {
            pendingNames = await stopNames.translateResult(result);
        } catch (err) {
            console.error('[routes] stop names:', err.message); // the timetable names then
        }
        res.json({ success: true, ...result, pendingNames });
    } catch (error) {
        if (error instanceof routeService.RouteError) return res.status(error.status).json({ error: error.message });
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// STOP NAMES learned since a search (stopNames.js): the route page asks for
// the ones it still shows in the local script. Body { keys: [nameKey],
// originals: [headsign or line station names] }.
router.post('/stop-names', async (req, res) => {
    const strings = v => (Array.isArray(v) ? v : []).filter(k => typeof k === 'string' && k.length <= 200).slice(0, 200);
    try {
        res.json({ names: await stopNames.namesFor(strings(req.body?.keys), strings(req.body?.originals)) });
    } catch (err) {
        console.error('[routes] stop names:', err.message);
        res.json({ names: [] });
    }
});

// PLACES FOR A CONNECTION — the stops of a chosen connection, matched to the
// trip's places: a stop within NEAR_METRES of one is that place, and stops that
// close to each other (the platform you arrive at and the bus stop outside)
// become one new place. A new place whose timetable name is not in Latin
// script gets the English name of that station from OpenStreetMap when one is
// found. Answers { places: [{key, id?, name, originalName, lat, lon}], keys }
// with one key per stop, in the order sent.
router.post('/:id/routes/places', routePlacesLimiter, async (req, res) => {
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
        // Only stops with a name worth translating count towards the cap.
        for (const p of proposals.filter(p => !p.id && !geocodeService.isLatin(p.originalName)).slice(0, MAX_NAME_LOOKUPS)) {
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
            const { item, error } = parseItem('transport', { ...leg, from: null, to: null });
            if (error) return res.status(400).json({ error: `${text(leg?.title, 160) || 'A leg'}: ${error}` });
            item.from = refs.get(text(leg.fromKey, 40)) ?? null;
            item.to = refs.get(text(leg.toKey, 40)) ?? null;
            items.push(item);
        }

        const result = await tripService.createItems(req.params.id, req.user.id, 'transport', items);
        if (!result.success) return res.status(404).json(result);
        res.status(201).json(result);
        // New places from stops have no address yet: looked up afterwards.
        placeAddresses.fillMissing(req.params.id).catch(err => console.error('[routes] addresses:', err.message));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
