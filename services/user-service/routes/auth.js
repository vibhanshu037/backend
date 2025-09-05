const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const AuthUtil = require('../../../shared/utils/auth');
const ValidationUtil = require('../../../shared/utils/validation');
const database = require('../../../config/database');
const redisClient = require('../../../config/redis');
const logger = require('../../../config/logger');
const userSchema = require('../../../shared/models/User');

const router = express.Router();

// Get User model
const getUserModel = () => {
  const connection = database.getConnection('users');
  return connection.model('User', userSchema);
};

// Register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  body('username').isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
  body('firstName').isLength({ min: 1, max: 50 }).trim(),
  body('lastName').isLength({ min: 1, max: 50 }).trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, password, username, firstName, lastName, phone } = req.body;
    const User = getUserModel();

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'Email or username is already taken'
      });
    }

    // Create new user
    const user = new User({
      email,
      password,
      username,
      firstName,
      lastName,
      phone: phone || null
    });

    await user.save();

    // Generate tokens
    const payload = { 
      userId: user._id, 
      email: user.email, 
      username: user.username,
      role: user.role 
    };
    
    const accessToken = AuthUtil.generateAccessToken(payload);
    const refreshToken = AuthUtil.generateRefreshToken(payload);

    // Store refresh token
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      deviceInfo: req.headers['user-agent'] || 'Unknown'
    });
    await user.save();

    // Cache user session
    await redisClient.set(
      `user_session:${user._id}`, 
      { userId: user._id, status: 'online' },
      3600
    );

    logger.info(`User registered: ${user.email}`);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: 'Please try again later'
    });
  }
});

// Login
router.post('/login', [
  body('identifier').notEmpty().trim(), // email or username
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { identifier, password } = req.body;
    const User = getUserModel();

    // Find user by email or username
    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier }
      ]
    });

    if (!user) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({
        error: 'Account locked',
        message: 'Too many failed login attempts. Please try again later.'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Account disabled',
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.incrementLoginAttempts();
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Update last login
    user.lastLogin = new Date();
    user.status = 'online';
    await user.save();

    // Generate tokens
    const payload = { 
      userId: user._id, 
      email: user.email, 
      username: user.username,
      role: user.role 
    };
    
    const accessToken = AuthUtil.generateAccessToken(payload);
    const refreshToken = AuthUtil.generateRefreshToken(payload);

    // Store refresh token
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      deviceInfo: req.headers['user-agent'] || 'Unknown'
    });
    await user.save();

    // Cache user session
    await redisClient.set(
      `user_session:${user._id}`, 
      { userId: user._id, status: 'online' },
      3600
    );

    logger.info(`User logged in: ${user.email}`);

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
        status: user.status,
        preferences: user.preferences
      },
      tokens: {
        accessToken,
        refreshToken
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: 'Please try again later'
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        error: 'Refresh token required'
      });
    }

    // Verify refresh token
    const decoded = AuthUtil.verifyRefreshToken(refreshToken);
    const User = getUserModel();
    
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Invalid refresh token'
      });
    }

    // Check if refresh token exists in user's tokens
    const tokenExists = user.refreshTokens.some(t => t.token === refreshToken);
    if (!tokenExists) {
      return res.status(401).json({
        error: 'Invalid refresh token'
      });
    }

    // Generate new access token
    const payload = { 
      userId: user._id, 
      email: user.email, 
      username: user.username,
      role: user.role 
    };
    
    const newAccessToken = AuthUtil.generateAccessToken(payload);

    res.json({
      accessToken: newAccessToken
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      error: 'Token refresh failed',
      message: error.message
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const authorization = req.headers.authorization;

    if (authorization) {
      const accessToken = AuthUtil.extractTokenFromHeader(authorization);
      const decoded = AuthUtil.verifyAccessToken(accessToken);
      
      const User = getUserModel();
      const user = await User.findById(decoded.userId);
      
      if (user) {
        // Remove refresh token
        if (refreshToken) {
          user.refreshTokens = user.refreshTokens.filter(t => t.token !== refreshToken);
          await user.save();
        }

        // Update user status
        user.status = 'offline';
        await user.save();

        // Remove from cache
        await redisClient.del(`user_session:${user._id}`);
        
        logger.info(`User logged out: ${user.email}`);
      }
    }

    res.json({
      message: 'Logout successful'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.json({
      message: 'Logout successful'
    });
  }
});

// Logout from all devices
router.post('/logout-all', async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    const accessToken = AuthUtil.extractTokenFromHeader(authorization);
    const decoded = AuthUtil.verifyAccessToken(accessToken);
    
    const User = getUserModel();
    const user = await User.findById(decoded.userId);
    
    if (user) {
      // Remove all refresh tokens
      user.refreshTokens = [];
      user.status = 'offline';
      await user.save();

      // Remove from cache
      await redisClient.del(`user_session:${user._id}`);
      
      logger.info(`User logged out from all devices: ${user.email}`);
    }

    res.json({
      message: 'Logged out from all devices successfully'
    });

  } catch (error) {
    logger.error('Logout all error:', error);
    res.status(401).json({
      error: 'Logout failed',
      message: error.message
    });
  }
});

module.exports = router;