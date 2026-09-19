// CREATE
const router = require('express').Router();
const { expenseService } = require('../crudService');

// CREATE
router.post('/', async (req, res) => {
    try {
        const currUserId = req.user.id
        const { groupId, description, categoryId, amount, currencyIso, date, paidByUserId } = req.body;
        // Call the service
        const result = await expenseService.createExpense(groupId, description, categoryId, amount, currencyIso, date, paidByUserId, currUserId);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ONE
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await expenseService.getExpensesById(id, req.user.id);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const  currUserId  = req.user.id;
        const { id } = req.params;
        const { groupId, description, categoryId, amount, currencyIso, date, paidByUserId } = req.body;
        const result = await expenseService.updateExpense(id,groupId, description, categoryId, amount, currencyIso, date, paidByUserId, currUserId);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await expenseService.deleteExpenseById(id, req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;