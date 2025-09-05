const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('../../config/config');
const logger = require('../../config/logger');
const redisClient = require('../../config/redis');

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "wss:", "ws:"],
      mediaSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "blob:"]
    }
  }
}));

app.use(cors({
  origin: config.security.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimiting.windowMs,
  max: config.rateLimiting.max,
  message: config.rateLimiting.message,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisClient.isClientConnected() ? require('rate-limit-redis')({
    client: redisClient.getClient()
  }) : undefined
});

app.use(limiter);

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'API Gateway is running',
    timestamp: new Date().toISOString(),
    services: {
      userService: `http://localhost:${config.ports.userService}`,
      mediaServer: `http://localhost:${config.ports.mediaServer}`,
      chatService: `http://localhost:${config.ports.chatService}`,
      recordingService: `http://localhost:${config.ports.recordingService}`,
      notificationService: `http://localhost:${config.ports.notificationService}`,
      fileService: `http://localhost:${config.ports.fileService}`
    }
  });
});

// Service discovery and proxy configuration
const services = {
  '/api/users': {
    target: `http://localhost:${config.ports.userService}`,
    pathRewrite: { '^/api/users': '/api' },
    changeOrigin: true
  },
  '/api/meetings': {
    target: `http://localhost:${config.ports.mediaServer}`,
    pathRewrite: { '^/api/meetings': '/api' },
    changeOrigin: true
  },
  '/api/chat': {
    target: `http://localhost:${config.ports.chatService}`,
    pathRewrite: { '^/api/chat': '/api' },
    changeOrigin: true
  },
  '/api/files': {
    target: `http://localhost:${config.ports.fileService}`,
    pathRewrite: { '^/api/files': '/api' },
    changeOrigin: true
  },
  '/api/recordings': {
    target: `http://localhost:${config.ports.recordingService}`,
    pathRewrite: { '^/api/recordings': '/api' },
    changeOrigin: true
  },
  '/api/notifications': {
    target: `http://localhost:${config.ports.notificationService}`,
    pathRewrite: { '^/api/notifications': '/api' },
    changeOrigin: true
  }
};

// WebSocket proxy for real-time connections
const wsProxies = {
  '/socket.io/media': {
    target: `http://localhost:${config.ports.mediaServer}`,
    ws: true,
    changeOrigin: true
  },
  '/socket.io/chat': {
    target: `http://localhost:${config.ports.chatService}`,
    ws: true,
    changeOrigin: true
  }
};

// Setup HTTP proxies
Object.keys(services).forEach(path => {
  const proxyOptions = {
    ...services[path],
    onError: (err, req, res) => {
      logger.error(`Proxy error for ${path}:`, err);
      res.status(503).json({ 
        error: 'Service temporarily unavailable',
        service: path 
      });
    },
    onProxyReq: (proxyReq, req, res) => {
      logger.info(`Proxying ${req.method} ${req.url} to ${services[path].target}`);
    }
  };

  app.use(path, createProxyMiddleware(proxyOptions));
});

// Setup WebSocket proxies
Object.keys(wsProxies).forEach(path => {
  const proxyOptions = {
    ...wsProxies[path],
    onError: (err, req, res) => {
      logger.error(`WebSocket proxy error for ${path}:`, err);
    }
  };

  app.use(path, createProxyMiddleware(proxyOptions));
});

// Default route
app.get('/', (req, res) => {
  res.json({
    message: 'Video Conferencing Platform API Gateway',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/health'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.originalUrl
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('API Gateway error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = config.ports.apiGateway;

const startServer = async () => {
  try {
    // Try to connect to Redis for rate limiting and caching (optional in development)
    try {
      await redisClient.connect();
      logger.info('Redis connected for API Gateway');
    } catch (redisError) {
      logger.warn('Redis not available, continuing without caching:', redisError.message);
    }
    
    const server = app.listen(PORT, () => {
      logger.info(`API Gateway running on http://localhost:${PORT}`);
      logger.info('Service routes configured:', Object.keys(services));
      logger.info('WebSocket routes configured:', Object.keys(wsProxies));
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down API Gateway...');
      server.close(async () => {
        if (redisClient.isClientConnected()) {
          await redisClient.disconnect();
        }
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start API Gateway:', error);
    process.exit(1);
  }
};

startServer();