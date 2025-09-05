const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware, adminMiddleware } = require('../../../middleware/auth');
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

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.user.userId).select('-password -refreshTokens');
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
        preferences: user.preferences,
        isEmailVerified: user.isEmailVerified,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to get profile'
    });
  }
});

// Update current user profile
router.put('/me', authMiddleware, [
  body('firstName').optional().isLength({ min: 1, max: 50 }).trim(),
  body('lastName').optional().isLength({ min: 1, max: 50 }).trim(),
  body('phone').optional().isMobilePhone()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { firstName, lastName, phone, preferences } = req.body;
    const User = getUserModel();
    
    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (phone) updateData.phone = phone;
    if (preferences) updateData.preferences = { ...preferences };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, select: '-password -refreshTokens' }
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Update cache
    await redisClient.set(
      `user_session:${user._id}`, 
      { userId: user._id, status: user.status },
      3600
    );

    logger.info(`User profile updated: ${user.email}`);

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatar: user.avatar,
        role: user.role,
        status: user.status,
        preferences: user.preferences
      }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile'
    });
  }
});

// Update user status
router.put('/status', authMiddleware, [
  body('status').isIn(['online', 'offline', 'busy', 'away'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { status } = req.body;
    const User = getUserModel();
    
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { status },
      { new: true, select: 'status' }
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Update cache
    await redisClient.set(
      `user_session:${user._id}`, 
      { userId: user._id, status: user.status },
      3600
    );

    logger.info(`User status updated: ${req.user.email} - ${status}`);

    res.json({
      message: 'Status updated successfully',
      status: user.status
    });

  } catch (error) {
    logger.error('Update status error:', error);
    res.status(500).json({
      error: 'Failed to update status'
    });
  }
});

// Search users
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        error: 'Search query must be at least 2 characters'
      });
    }

    const User = getUserModel();
    const searchRegex = new RegExp(q, 'i');
    
    const users = await User.find({
      $and: [
        { isActive: true },
        { _id: { $ne: req.user.userId } },
        {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { username: searchRegex },
            { email: searchRegex }
          ]
        }
      ]
    })
    .select('firstName lastName username email avatar status')
    .limit(parseInt(limit));

    res.json({
      users: users.map(user => ({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        status: user.status
      }))
    });

  } catch (error) {
    logger.error('User search error:', error);
    res.status(500).json({
      error: 'Failed to search users'
    });
  }
});

// Get user by ID (public info only)
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const User = getUserModel();
    
    const user = await User.findById(userId)
      .select('firstName lastName username avatar status isActive');

    if (!user || !user.isActive) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatar: user.avatar,
        status: user.status
      }
    });

  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({
      error: 'Failed to get user'
    });
  }
});

// Admin: Get all users
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, role } = req.query;
    const User = getUserModel();
    
    const query = {};
    if (status) query.status = status;
    if (role) query.role = role;

    const users = await User.find(query)
      .select('-password -refreshTokens')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      error: 'Failed to get users'
    });
  }
});

// Admin: Update user role
router.put('/:userId/role', authMiddleware, adminMiddleware, [
  body('role').isIn(['user', 'admin', 'moderator'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { userId } = req.params;
    const { role } = req.body;
    const User = getUserModel();
    
    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true, select: '-password -refreshTokens' }
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    logger.info(`User role updated by admin: ${user.email} - ${role}`);

    res.json({
      message: 'User role updated successfully',
      user
    });

  } catch (error) {
    logger.error('Update user role error:', error);
    res.status(500).json({
      error: 'Failed to update user role'
    });
  }
});

// Admin: Deactivate user
router.put('/:userId/deactivate', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const User = getUserModel();
    
    const user = await User.findByIdAndUpdate(
      userId,
      { isActive: false, status: 'offline' },
      { new: true, select: '-password -refreshTokens' }
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Remove from cache
    await redisClient.del(`user_session:${userId}`);

    logger.info(`User deactivated by admin: ${user.email}`);

    res.json({
      message: 'User deactivated successfully',
      user
    });

  } catch (error) {
    logger.error('Deactivate user error:', error);
    res.status(500).json({
      error: 'Failed to deactivate user'
    });
  }
});

module.exports = router;