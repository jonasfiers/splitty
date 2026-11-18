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
        res.set('Cache-Control', 'no-store');
        res.json({
            ...view,
            photos: view.photos.map(p => ({
                at: p.at, lat: p.lat, lon: p.lon, ratio: p.ratio, video: p.video, id: p.id, album: p.album,
                thumb: `/follow/${token}/photos/${p.album}/${p.id}/thumbnail`,
                preview: `/follow/${token}/photos/${p.album}/${p.id}/preview`,
            })),
        });
    } catch (err) {
        console.error('[follow] view:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

router.get('/:token/photos/:albumId/:assetId/:size', async (req, res) => {
    const { token, albumId, assetId, size } = req.params;
    if (!['thumbnail', 'preview'].includes(size)) return res.status(404).end();
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
