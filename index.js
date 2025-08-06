const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Serve static files
app.use(express.static('public'));

// MongoDB connection for admin
const connectAdminDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Admin MongoDB connected successfully');
    } catch (error) {
        console.error('Admin MongoDB connection error:', error);
        process.exit(1);
    }
};

// Routes
app.use('/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));

// Default route
app.get('/', (req, res) => {
    res.redirect('/admin/login');
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).render('404', { title: 'Page Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        title: 'Server Error', 
        message: 'Something went wrong!' 
    });
});

const PORT = process.env.ADMIN_PORT || 3000;

const startServer = async () => {
    await connectAdminDB();
    app.listen(PORT, () => {
        console.log(`Bearull Admin Panel running on http://localhost:${PORT}`);
    });
};

startServer();