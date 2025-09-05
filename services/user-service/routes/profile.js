const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../../../middleware/auth');
const database = require('../../../config/database');
const logger = require('../../../config/logger');
const userSchema = require('../../../shared/models/User');

const router = express.Router();

// Get User model
const getUserModel = () => {
  const connection = database.getConnection('users');
  return connection.model('User', userSchema);
};

// Get user profile (same as /me but for profile-specific routes)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findById(req.user.userId).select('-password -refreshTokens');
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      profile: {
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

// Update user preferences
router.put('/preferences', authMiddleware, async (req, res) => {
  try {
    const { preferences } = req.body;
    const User = getUserModel();
    
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { 
        $set: {
          'preferences.notifications': preferences.notifications || {},
          'preferences.video': preferences.video || {},
          'preferences.privacy': preferences.privacy || {}
        }
      },
      { new: true, select: 'preferences' }
    );

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    logger.info(`User preferences updated: ${req.user.email}`);

    res.json({
      message: 'Preferences updated successfully',
      preferences: user.preferences
    });

  } catch (error) {
    logger.error('Update preferences error:', error);
    res.status(500).json({
      error: 'Failed to update preferences'
    });
  }
});

// Change password
router.put('/password', authMiddleware, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const User = getUserModel();
    
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        error: 'Invalid current password'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logger.info(`Password changed for user: ${user.email}`);

    res.json({
      message: 'Password updated successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      error: 'Failed to change password'
    });
  }
});

module.exports = router;