// Reads are open to every signed-in user (the expense form, groups and
// Home need them); creating, editing and deleting are admin-only.
const router = require('express').Router();
const requireAdmin = require('../middleware/requireAdmin');
const { categoryServiceNeo4j } = require('../crudService');

// CREATE
router.post('/', requireAdmin, async (req, res) => {
    try {
        const { name, parentId, icon, colour } = req.body;
        const result = await categoryServiceNeo4j.createCategory(name, parentId, icon, colour);
        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ ALL
router.get('/', async (req, res) => {
    try {
        const { groupId } = req.query;
        const result = await categoryServiceNeo4j.getAllCategories(groupId || null);
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
        const category = await categoryServiceNeo4j.getCategoryById(id);
        if (!category.success) return res.status(404).json(category);
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// READ CHILDREN
router.get('/:id/children', async (req, res) => {
    try {
        const { id } = req.params;
        const category = await categoryServiceNeo4j.getChildCategories(id);
        if (!category.success) return res.status(404).json(category);
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
// UPDATE
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, parentId, icon, colour } = req.body;
        const result = await categoryServiceNeo4j.updateCategory(id, name, parentId, icon, colour);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await categoryServiceNeo4j.deleteCategory(id);
        if (!result.success) return res.status(404).json(result);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;