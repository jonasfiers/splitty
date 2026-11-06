const router = require('express').Router();
const { expenseService } = require('../crudService');


// CREATE SETTLEMENT
router.post('/', async (req, res) => {
    try {
        const currUserId = req.user.id;
        const { groupId, amount, currencyIso, date, paidByUserId, receivedByUserId } = req.body;
        
        // Validation
        if (!groupId || !amount || !currencyIso || !date || !paidByUserId || !receivedByUserId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await expenseService.createSettlement(
            groupId, 
            amount, 
            currencyIso, 
            date, 
            paidByUserId, 
            receivedByUserId, 
            currUserId
        );
        if (!result.success) return res.status(result.status || 400).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// CREATE BALANCE TRANSFER
router.post('/transfer', async (req, res) => {
    try {
        const currUserId = req.user.id;
        const { sourceGroupId, targetGroupId, targetUserId } = req.body;

        if (!sourceGroupId || !targetGroupId || !targetUserId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await expenseService.createBalanceTransfer(
            sourceGroupId,
            targetGroupId,
            targetUserId,
            currUserId
        );
        if (!result.success) return res.status(400).json(result);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
