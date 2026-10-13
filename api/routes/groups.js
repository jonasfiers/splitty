// CREATE
const router = require('express').Router();
const { groupServiceNeo4j, expenseService } = require('../crudService');
const tripService = require('../tripService');
const uploadStore = require('../uploadStore');

// CREATE
router.post('/', async (req, res) => {
    try {
        const { title, currencyIso, icon } = req.body;
        const userId = req.user.id;
        const result = await groupServiceNeo4j.createGroup( title, currencyIso,userId, icon );
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ALL
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await groupServiceNeo4j.getAllGroups(userId);
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ONE
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const result = await groupServiceNeo4j.getGroupById(id,userId);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, currencyIso, icon } = req.body;
        const result = await groupServiceNeo4j.updateGroup(id, req.user.id, title, currencyIso, icon);
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
        // A group's trips (and their uploaded files) must not outlive it.
        const storedNames = await tripService.deleteTripsOfGroup(id, req.user.id);
        await uploadStore.remove(storedNames);
        const result = await groupServiceNeo4j.deleteGroup(id, req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET GROUP EXPENSES
router.get('/:id/expenses', async (req, res) => {
    try {
        const userId = req.user.id
        const { id } = req.params
        const skip  = parseInt(req.query.skip)  || 0
        const limit = parseInt(req.query.limit) || 25
        const filters = {
            keyword:      req.query.keyword      || undefined,
            categoryId:   req.query.categoryId   || undefined,
            paidByUserId: req.query.paidByUserId || undefined,
            startDate:    req.query.startDate    || undefined,
            endDate:      req.query.endDate      || undefined,
        }
        const result = await expenseService.getExpensesByGroupId(id, userId, skip, limit, filters)
        res.status(200).json(result)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
});

// GET CATEGORY TOTALS
router.get('/:id/category-totals', async (req, res) => {
    try {
        const result = await expenseService.getGroupCategoryTotals(req.params.id, req.user.id)
        res.json(result)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// GET SHARED GROUPS + BILATERAL BALANCE (balance transfer UI)
router.get('/:id/shared-groups/:targetUserId', async (req, res) => {
    try {
        const { id, targetUserId } = req.params;
        const result = await groupServiceNeo4j.getSharedGroupsAndBalance(id, targetUserId, req.user.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET GROUP MEMBERS
router.get('/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await groupServiceNeo4j.getGroupMembers(id, req.user.id);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ADD USER TO GROUP
router.post('/:id/:userId', async (req, res) => {
    try {
        const { id, userId } = req.params;
        const result = await groupServiceNeo4j.createGroupUser(id, userId, req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// DELETE USER TO GROUP
router.delete('/:id/:userId', async (req, res) => {
    try {
        const { id, userId } = req.params;
        const result = await groupServiceNeo4j.deleteGroupUser(id, userId, req.user.id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;