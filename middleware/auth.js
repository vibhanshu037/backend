const AuthUtil = require('../shared/utils/auth');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

const authMiddleware = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    
    if (!authorization) {
      return res.status(401).json({
        error: 'Authorization required',
        message: 'No authorization header provided'
      });
    }

    const token = AuthUtil.extractTokenFromHeader(authorization);
    const decoded = AuthUtil.verifyAccessToken(token);

    // Check if user session exists in cache
    const userSession = await redisClient.get(`user_session:${decoded.userId}`);
    if (!userSession) {
      return res.status(401).json({
        error: 'Session expired',
        message: 'Please log in again'
      });
    }

    // Add user info to request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      username: decoded.username,
      role: decoded.role
    };

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(401).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
};

const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    
    if (authorization) {
      const token = AuthUtil.extractTokenFromHeader(authorization);
      const decoded = AuthUtil.verifyAccessToken(token);
      
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        username: decoded.username,
        role: decoded.role
      };
    }

    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin access required',
      message: 'You do not have permission to access this resource'
    });
  }

  next();
};

const moderatorMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  if (!['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).json({
      error: 'Moderator access required',
      message: 'You do not have permission to access this resource'
    });
  }

  next();
};

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware,
  moderatorMiddleware
};