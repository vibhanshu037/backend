const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const config = require('../../config/config');
const logger = require('../../config/logger');
const database = require('../../config/database');
const redisClient = require('../../config/redis');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const profileRoutes = require('./routes/profile');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.security.corsOrigins,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use(limiter);

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  store: new RedisStore({ client: redisClient.getClient() }),
  secret: config.security.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'User Service',
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('User Service error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = config.ports.userService;

const startServer = async () => {
  try {
    // Connect to databases
    await database.connect('users', config.databases.users);
    await redisClient.connect();
    
    const server = app.listen(PORT, () => {
      logger.info(`User Service running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down User Service...');
      server.close(async () => {
        await database.closeAllConnections();
        await redisClient.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start User Service:', error);
    process.exit(1);
  }
};

startServer();