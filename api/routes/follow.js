// "Follow my trip" (followService.js): the public, read-only view of a trip
// through its link. No login; the link's token is the only key, and the view
// holds nothing private. Not for search engines.
const router = require('express').Router();
const { Readable } = require('stream');
const followService = require('../followService');
const tripPhotos = require('../tripPhotos');

router.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

router.get('/:token', async (req, res) => {
    try {
        const view = await followService.publicView(req.params.token);
        if (!view) return res.status(404).json({ error: 'This link does not work (any more).' });
        const { token } = view;
        followService.countView(token, req.headers['x-real-ip'] || req.ip, String(req.headers['user-agent'] || ''))
            .catch(err => console.error('[follow] count:', err.message));
        res.set('Cache-Control', 'no-store');
        res.json({
            ...view,
            photos: view.photos.map(p => ({
                at: p.at, lat: p.lat, lon: p.lon, ratio: p.ratio, video: p.video, id: p.id, album: p.album,
                thumb: `/follow/${token}/photos/${p.album}/${p.id}/thumbnail`,
                preview: `/follow/${token}/photos/${p.album}/${p.id}/preview`,
                ...(p.video ? { play: `/follow/${token}/photos/${p.album}/${p.id}/video` } : {}),
            })),
        });
    } catch (err) {
        console.error('[follow] view:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// The link preview (WhatsApp, Signal, …): Open Graph tags for the page's
// <head>, slotted in by nginx (SSI) on /follow/<token> only, since chat apps
// read the raw HTML and run no JavaScript. Nothing beyond what the page shows.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

router.get('/:token/meta', async (req, res) => {
    res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    try {
        const view = await followService.publicView(req.params.token);
        if (!view) return res.send('');
        const base = followService.followOrigin();
        const name = id => view.places.find(p => p.id === id)?.name;
        let where = '';
        const last = view.items[view.items.length - 1];
        if (last) {
            where = last.kind === 'transport' && !last.toPlaceId
                ? (name(last.fromPlaceId) ? `on the way from ${name(last.fromPlaceId)}` : 'on the way')
                : (name(last.toPlaceId || last.placeId) ? `in ${name(last.toPlaceId || last.placeId)}` : '');
        }
        const s = view.summary;
        const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n !== 1 ? 's' : ''}`;
        const description = !view.started
            ? 'The trip hasn’t started yet. Each day appears here as it comes.'
            : view.trip.endDate
                ? [plural(s.days, 'day'), s.towns > 1 && plural(s.towns, 'town'), s.km >= 100 && `${s.km.toLocaleString('en')} km`, s.photos && plural(s.photos, 'photo')].filter(Boolean).join(' · ')
                : [`Day ${daysBetween(view.trip.startDate, view.today) + 1}`, where && `now ${where}`].filter(Boolean).join(' · ');
        // A finished trip: its first photo, as the slideshow opens on it.
        const photo = view.ended ? view.photos[0] : view.photos[view.photos.length - 1];
        const image = photo
            ? `${base}/api/follow/${view.token}/photos/${photo.album}/${photo.id}/preview`
            : `${base}/cat-icon-512.png`;
        const title = view.ended ? `${view.sharer}’s trip: ${view.trip.title}` : `Follow ${view.sharer}’s trip: ${view.trip.title}`;
        res.send([
            `<meta property="og:type" content="website">`,
            `<meta property="og:site_name" content="Splitty">`,
            `<meta property="og:title" content="${esc(title)}">`,
            `<meta property="og:description" content="${esc(description)}">`,
            `<meta property="og:url" content="${esc(followService.followUrl(view.token))}">`,
            `<meta property="og:image" content="${esc(image)}">`,
            `<meta name="twitter:card" content="${photo ? 'summary_large_image' : 'summary'}">`,
            `<meta name="description" content="${esc(description)}">`,
            `<meta name="robots" content="noindex, nofollow">`,
        ].join('\n'));
    } catch (err) {
        console.error('[follow] meta:', err);
        res.send('');
    }
});

// A video the link shows, streamed (tripPhotos.streamVideo).
router.get('/:token/photos/:albumId/:assetId/video', async (req, res) => {
    const { token, albumId, assetId } = req.params;
    try {
        const album = await followService.photoAllowed(token, albumId, assetId);
        if (!album) return res.status(404).end();
        await tripPhotos.streamVideo(album, assetId, req, res, 'private, max-age=3600');
    } catch (err) {
        if (res.headersSent) return res.destroy();
        if (err instanceof tripPhotos.PhotoError) return res.status(err.status).end();
        console.error('[follow] video:', err);
        res.status(500).end();
    }
});

router.get('/:token/photos/:albumId/:assetId/:size', async (req, res, next) => {
    const { token, albumId, assetId, size } = req.params;
    if (!['thumbnail', 'preview'].includes(size)) return next(); // video: below
    try {
        const album = await followService.photoAllowed(token, albumId, assetId);
        if (!album) return res.status(404).end();
        const upstream = await tripPhotos.thumbnail(album, assetId, size);
        const type = upstream.headers.get('content-type') || '';
        if (!type.startsWith('image/')) return res.status(502).end();
        res.set({ 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        const len = upstream.headers.get('content-length');
        if (len) res.set('Content-Length', len);
        Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
        if (err instanceof tripPhotos.PhotoError) return res.status(err.status).end();
        console.error('[follow] photo:', err);
        res.status(500).end();
    }
});

module.exports = router;
