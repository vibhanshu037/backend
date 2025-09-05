const express = require('express');
const router = express.Router();

// Admin login page
router.get('/login', (req, res) => {
    res.send('<h1>Admin Login</h1><p>Placeholder for admin panel</p>');
});

// Admin dashboard
router.get('/dashboard', (req, res) => {
    res.send('<h1>Admin Dashboard</h1><p>Placeholder for admin dashboard</p>');
});

module.exports = router;