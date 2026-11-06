// Reads are open to every signed-in user (the expense form, groups and
// Home need them); creating, editing and deleting are admin-only.
const router = require('express').Router();
const requireAdmin = require('../middleware/requireAdmin');
const { currencyServiceNeo4j } = require('../crudService');

// CREATE
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { iso } = req.body;
        // Call the service
        const result = await currencyServiceNeo4j.createCurrency(iso)
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ALL
router.get('/', async (req, res) => {
    try {
        const result = await currencyServiceNeo4j.getAllCurrencies();
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ONE
router.get('/:iso', async (req, res) => {
    try {
        const { iso } = req.params;
        const category = await currencyServiceNeo4j.getCurrencyByIso(iso);
        if (!category.success) return res.status(404).json(category);
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE
router.put('/:iso', requireAdmin, async (req, res) => {
    try {
        const { iso } = req.params;
        const { label, symbol, amountOfDecimals } = req.body;
        const result = await currencyServiceNeo4j.updateCurrency(iso,label, symbol, amountOfDecimals);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE
router.delete('/:iso', requireAdmin, async (req, res) => {
    try {
        const { iso } = req.params;
        const result = await currencyServiceNeo4j.deleteCurrency(iso);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;