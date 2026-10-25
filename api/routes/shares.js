const router = require('express').Router();
const { shareService } = require('../crudService');

// CREATE
router.post('/', async (req, res) => {
    try {
        const { expenseId, userId, amount } = req.body;
        const result = await shareService.createShare(expenseId, userId, amount, req.user.id);
        if (result.status) return res.status(result.status).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

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

// DELETE
router.delete('/expense/:expenseId/user/:userId', async (req, res) => {
    try {
        const { expenseId, userId } = req.params;
        const result = await shareService.deleteShare(expenseId, userId, req.user.id);
        if (!result.success) return res.status(result.status || 404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;