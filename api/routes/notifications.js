const router = require('express').Router()
const pushService = require('../pushService')

router.get('/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

router.post('/subscribe', async (req, res) => {
    try {
        await pushService.saveSubscription(req.user.id, req.body.subscription)
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.delete('/subscribe', async (req, res) => {
    try {
        await pushService.deleteSubscription(req.user.id, req.body.endpoint)
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// Logout: disable, don't delete
router.post('/disable', async (req, res) => {
    try {
        await pushService.disableSubscription(req.user.id, req.body.endpoint)
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// Login: re-enable if this user already had this device subscribed
router.post('/reactivate', async (req, res) => {
    try {
        const reactivated = await pushService.reactivateSubscription(req.user.id, req.body.endpoint)
        res.json({ success: true, reactivated })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

module.exports = router
