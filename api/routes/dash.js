const exportService = require('../exportService');
const router = require('express').Router();
const { dashService } = require('../dashService');

router.get('/balance', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await dashService.getBalances(userId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({error: error.message});
    }
});

router.get('/friends', async (req, res) => {
    try {
        res.json(await dashService.getFriends(req.user.id));
    }
    catch (error) {
        res.status(500).json({error: error.message});
    }
});

router.get('/groups', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await dashService.getGroupCards(userId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({error: error.message});
    }
})

router.get('/activity', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await dashService.getActivity(userId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({error: error.message})
    }
})

router.get('/profile', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await dashService.getProfile(userId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({error: error.message});
    }
})

// ?today=YYYY-MM-DD: the user's date; without it (or malformed), the server's.
router.get('/recent-spend', async (req, res) => {
    try {
        const { today } = req.query
        const day = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) && !isNaN(Date.parse(today))
            ? today : new Date().toISOString().slice(0, 10)
        res.json(await dashService.getRecentSpend(req.user.id, day))
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/insights', async (req, res) => {
    try {
        // All optional; anything malformed is ignored rather than rejected.
        const { from, groupId, iso, scope } = req.query
        const result = await dashService.getInsights(req.user.id, {
            from: typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
            groupId: typeof groupId === 'string' && groupId ? groupId : null,
            iso: typeof iso === 'string' && /^[A-Z]{3}$/.test(iso) ? iso : null,
            mine: scope === 'mine',
        })
        res.json(result)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Everything the user can see, as one ZIP (GDPR access/portability): see
// exportService.js. Replaces the old CSV export, which wrote amounts in cents
// and missed the payer's own share.
router.get('/export', async (req, res) => {
    try {
        const zip = await exportService.buildZip(req.user.id);
        if (!zip) return res.status(404).json({ error: 'Account not found' });
        const day = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="splitty-export-${day}.zip"`);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(zip);
    } catch (error) {
        console.error('Export failed:', error);
        res.status(500).json({ error: 'Failed to build the export' });
    }
});

module.exports = router;