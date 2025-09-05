const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// Placeholder for API routes
router.get('/', (req, res) => {
    res.json({ message: 'Video Conferencing API - Coming Soon' });
});

module.exports = router;