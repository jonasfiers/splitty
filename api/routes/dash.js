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

router.get('/insights', async (req, res) => {
    try {
        // All optional; anything malformed is ignored rather than rejected.
        const { from, groupId, scope } = req.query
        const result = await dashService.getInsights(req.user.id, {
            from: typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
            groupId: typeof groupId === 'string' && groupId ? groupId : null,
            mine: scope === 'mine',
        })
        res.json(result)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

router.get('/export', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await dashService.getExportData(userId);
        
        if (!result.success) {
            return res.status(500).json({ error: 'Failed to generate export data' });
        }

        const data = result.data;
        const headers = ['Date', 'Description', 'Amount', 'Currency', 'Category', 'Group', 'Paid By', 'My Share', 'Is Settlement'];
        const csvRows = [headers.join(',')];

        for (const row of data) {
            const values = [
                row.date || '',
                `"${(row.description || '').replace(/"/g, '""')}"`,
                row.amount || 0,
                row.currency || '',
                `"${(row.category || '').replace(/"/g, '""')}"`,
                `"${(row.group || '').replace(/"/g, '""')}"`,
                `"${(row.paidBy || '').replace(/"/g, '""')}"`,
                row.myShare || 0,
                row.isSettlement || false
            ];
            csvRows.push(values.join(','));
        }

        const csvString = csvRows.join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=splitty_export.csv');
        res.status(200).send(csvString);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;