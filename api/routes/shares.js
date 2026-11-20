const router = require('express').Router();
const { shareService } = require('../crudService');

// Shares are written only with their expense (POST/PUT /expenses), which
// checks them: everyone in the group, nobody twice, no more than the total,
// and records the change. The separate create/delete routes that skipped all
// of that (a member could put a debt on anyone) were removed on 2026-11-20;
// the app had stopped using them in 1f96f79.

// GET ALL FOR EXPENSE
router.get('/expense/:expenseId', async (req, res) => {
    try {
        const { expenseId } = req.params;
        const result = await shareService.getShares(expenseId, false, req.user.id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// GET ALL EXCEPT PAYER SHARE FOR EXPENSE
router.get('/expense/:expenseId/excludePayer', async (req, res) => {
    try {
        const { expenseId } = req.params;
        const result = await shareService.getShares(expenseId, true, req.user.id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;