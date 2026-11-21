const router = require('express').Router();
const multer = require('multer');
const { expenseService } = require('../crudService');
const tripService = require('../tripService');
const receiptService = require('../receiptService');
const uploadStore = require('../uploadStore');
const { signFileLink } = require('../fileLinks');

// Receipts carry short-lived signed links (fileLinks.js), fresh with each read.
const withLinks = receipts => receipts.map(r => ({ ...r, url: signFileLink(r.id) }));
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadStore.MAX_BYTES, files: 1 },
}).single('file');

// CREATE
router.post('/', async (req, res) => {
    try {
        const currUserId = req.user.id
        const { groupId, description, categoryId, amount, currencyIso, date, paidByUserId, shares } = req.body;
        const result = await expenseService.createExpense(groupId, description, categoryId, amount, currencyIso, date, paidByUserId, currUserId, shares ?? []);
        if (!result.success) return res.status(result.status || 400).json(result);
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
        if (result.success) {
            result.expense.tripItem = await tripService.getItemForExpense(id, req.user.id);
            result.expense.receipts = withLinks(await receiptService.list(id, req.user.id) ?? []);
        }
        res.status(200).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// HISTORY — who created it and every edit, with what changed.
router.get('/:id/history', async (req, res) => {
    try {
        res.json({ history: await expenseService.getExpenseHistory(req.params.id, req.user.id) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load the history' });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const  currUserId  = req.user.id;
        const { id } = req.params;
        const { groupId, description, categoryId, amount, currencyIso, date, paidByUserId, shares } = req.body;
        const result = await expenseService.updateExpense(id, groupId, description, categoryId, amount, currencyIso, date, paidByUserId, currUserId, shares);
        if (!result.success) return res.status(result.status || 404).json(result);
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
        await receiptService.removeOrphans().catch(err => console.error('Receipt cleanup failed:', err.message));
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ── RECEIPTS ── photos or PDFs of the bill (receiptService.js).
router.get('/:id/receipts', async (req, res) => {
    try {
        const receipts = await receiptService.list(req.params.id, req.user.id);
        if (!receipts) return res.status(404).json({ error: 'Expense not found' });
        res.json({ success: true, receipts: withLinks(receipts) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load the receipts' });
    }
});

// multipart: file (PDF, JPEG, PNG or WebP; the app shrinks photos first)
router.post('/:id/receipts', (req, res) => {
    upload(req, res, async uploadError => {
        try {
            if (uploadError) {
                const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
                return res.status(tooBig ? 413 : 400).json({
                    error: tooBig ? `The file is larger than ${uploadStore.MAX_BYTES / 1024 / 1024} MB.` : 'Upload failed.',
                });
            }
            if (!req.file) return res.status(400).json({ error: 'No file was sent.' });
            if (!uploadStore.isAllowed(req.file.mimetype, req.file.buffer)) {
                return res.status(415).json({ error: 'Only PDF, JPEG, PNG and WebP files can be added.' });
            }
            const exists = await receiptService.list(req.params.id, req.user.id);
            if (!exists) return res.status(404).json({ error: 'Expense not found' });
            if (exists.length >= receiptService.MAX_PER_EXPENSE) {
                return res.status(400).json({ error: `An expense can have at most ${receiptService.MAX_PER_EXPENSE} receipts.` });
            }
            const storedName = await uploadStore.save(req.file.buffer);
            const result = await receiptService.create(req.params.id, req.user.id, {
                filename: uploadStore.cleanFilename(req.file.originalname, 'receipt'),
                mimeType: req.file.mimetype, size: req.file.size, storedName,
            });
            if (!result.success) {
                await uploadStore.remove([storedName]);
                return res.status(result.status).json({ error: result.message });
            }
            res.status(201).json({ success: true, receipt: { ...result.receipt, url: signFileLink(result.receipt.id) } });
        } catch (error) {
            if (error.code === 'STORAGE_FULL') {
                console.error(`Upload refused: less than ${uploadStore.MIN_FREE_BYTES / 1024 / 1024} MB would be left free in ${uploadStore.UPLOAD_DIR}`);
                return res.status(507).json({ error: 'Splitty’s storage is full, so files cannot be uploaded right now. Please tell the admin.' });
            }
            console.error(error);
            res.status(500).json({ error: 'Upload failed.' });
        }
    });
});

router.delete('/receipts/:receiptId', async (req, res) => {
    try {
        const storedNames = await receiptService.remove(req.params.receiptId, req.user.id);
        if (!storedNames.length) return res.status(404).json({ error: 'Receipt not found' });
        await uploadStore.remove(storedNames);
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete the receipt' });
    }
});

module.exports = router;