const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../../../middleware/auth');
const logger = require('../../../config/logger');

const router = express.Router();

// Get notifications for authenticated user
router.get('/my-notifications', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const notificationManager = req.app.locals.notificationManager;

    const notifications = await notificationManager.getUserNotifications(req.user.userId, {
      unreadOnly: unreadOnly === 'true'
    });

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedNotifications = notifications.slice(startIndex, endIndex);

    res.json({
      notifications: paginatedNotifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(notifications.length / limit),
        totalNotifications: notifications.length,
        unreadCount: notifications.filter(n => !n.isRead).length,
        hasNext: endIndex < notifications.length,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      error: 'Failed to get notifications'
    });
  }
});

// Mark notification as read
router.put('/:notificationId/read', authMiddleware, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const notificationManager = req.app.locals.notificationManager;

    await notificationManager.markAsRead(notificationId);

    logger.info(`Notification ${notificationId} marked as read by ${req.user.userId}`);

    res.json({
      message: 'Notification marked as read'
    });

  } catch (error) {
    logger.error('Mark notification as read error:', error);
    res.status(500).json({
      error: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', authMiddleware, async (req, res) => {
  try {
    const notificationManager = req.app.locals.notificationManager;
    const notifications = await notificationManager.getUserNotifications(req.user.userId, {
      unreadOnly: true
    });

    for (const notification of notifications) {
      await notificationManager.markAsRead(notification.id);
    }

    logger.info(`All notifications marked as read for user ${req.user.userId}`);

    res.json({
      message: 'All notifications marked as read',
      count: notifications.length
    });

  } catch (error) {
    logger.error('Mark all notifications as read error:', error);
    res.status(500).json({
      error: 'Failed to mark all notifications as read'
    });
  }
});

// Send meeting invitation
router.post('/invite', authMiddleware, [
  body('meetingId').notEmpty(),
  body('meetingTitle').notEmpty(),
  body('invitees').isArray({ min: 1 }),
  body('invitees.*.email').isEmail(),
  body('invitees.*.name').notEmpty(),
  body('startTime').isISO8601(),
  body('joinUrl').isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingId, meetingTitle, invitees, startTime, joinUrl, hostName } = req.body;
    const notificationManager = req.app.locals.notificationManager;

    const results = [];

    for (const invitee of invitees) {
      try {
        const success = await notificationManager.sendMeetingInvitation({
          inviteeEmail: invitee.email,
          inviteeName: invitee.name,
          meetingTitle,
          meetingId,
          hostName: hostName || `${req.user.firstName} ${req.user.lastName}`,
          startTime,
          joinUrl
        });

        results.push({
          email: invitee.email,
          name: invitee.name,
          sent: success,
          error: success ? null : 'Failed to send email'
        });

        // Create in-app notification if user exists in system
        await notificationManager.createNotification(
          invitee.userId || null,
          'meeting_invitation',
          `Meeting Invitation: ${meetingTitle}`,
          `You have been invited to join a meeting by ${hostName}`,
          {
            meetingId,
            meetingTitle,
            startTime,
            joinUrl,
            hostName
          }
        );

      } catch (error) {
        results.push({
          email: invitee.email,
          name: invitee.name,
          sent: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.sent).length;
    
    logger.info(`Meeting invitations sent: ${successCount}/${invitees.length} for meeting ${meetingId}`);

    res.json({
      message: `Invitations sent to ${successCount} out of ${invitees.length} invitees`,
      results,
      summary: {
        total: invitees.length,
        sent: successCount,
        failed: invitees.length - successCount
      }
    });

  } catch (error) {
    logger.error('Send meeting invitation error:', error);
    res.status(500).json({
      error: 'Failed to send meeting invitations'
    });
  }
});

// Send meeting reminder
router.post('/remind', authMiddleware, [
  body('meetingId').notEmpty(),
  body('meetingTitle').notEmpty(),
  body('participants').isArray({ min: 1 }),
  body('startTime').isISO8601(),
  body('joinUrl').isURL(),
  body('reminderTime').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingId, meetingTitle, participants, startTime, joinUrl, reminderTime } = req.body;
    const notificationManager = req.app.locals.notificationManager;

    const results = [];

    for (const participant of participants) {
      try {
        const success = await notificationManager.sendMeetingReminder({
          userEmail: participant.email,
          userName: participant.name,
          meetingTitle,
          meetingId,
          startTime,
          joinUrl,
          reminderTime
        });

        results.push({
          email: participant.email,
          name: participant.name,
          sent: success,
          error: success ? null : 'Failed to send email'
        });

        // Create in-app notification
        await notificationManager.createNotification(
          participant.userId || null,
          'meeting_reminder',
          `Meeting Reminder: ${meetingTitle}`,
          `Your meeting starts in ${reminderTime}`,
          {
            meetingId,
            meetingTitle,
            startTime,
            joinUrl,
            reminderTime
          }
        );

      } catch (error) {
        results.push({
          email: participant.email,
          name: participant.name,
          sent: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.sent).length;
    
    logger.info(`Meeting reminders sent: ${successCount}/${participants.length} for meeting ${meetingId}`);

    res.json({
      message: `Reminders sent to ${successCount} out of ${participants.length} participants`,
      results,
      summary: {
        total: participants.length,
        sent: successCount,
        failed: participants.length - successCount
      }
    });

  } catch (error) {
    logger.error('Send meeting reminder error:', error);
    res.status(500).json({
      error: 'Failed to send meeting reminders'
    });
  }
});

// Send recording ready notification
router.post('/recording-ready', authMiddleware, [
  body('meetingTitle').notEmpty(),
  body('recordingUrl').isURL(),
  body('downloadUrl').isURL(),
  body('recipients').isArray({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingTitle, recordingUrl, downloadUrl, recipients } = req.body;
    const notificationManager = req.app.locals.notificationManager;

    const results = [];

    for (const recipient of recipients) {
      try {
        const success = await notificationManager.sendRecordingReady({
          userEmail: recipient.email,
          userName: recipient.name,
          meetingTitle,
          recordingUrl,
          downloadUrl
        });

        results.push({
          email: recipient.email,
          name: recipient.name,
          sent: success,
          error: success ? null : 'Failed to send email'
        });

        // Create in-app notification
        await notificationManager.createNotification(
          recipient.userId || null,
          'recording_ready',
          `Recording Available: ${meetingTitle}`,
          'Your meeting recording is ready for download',
          {
            meetingTitle,
            recordingUrl,
            downloadUrl
          }
        );

      } catch (error) {
        results.push({
          email: recipient.email,
          name: recipient.name,
          sent: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.sent).length;
    
    logger.info(`Recording ready notifications sent: ${successCount}/${recipients.length}`);

    res.json({
      message: `Recording notifications sent to ${successCount} out of ${recipients.length} recipients`,
      results,
      summary: {
        total: recipients.length,
        sent: successCount,
        failed: recipients.length - successCount
      }
    });

  } catch (error) {
    logger.error('Send recording ready notification error:', error);
    res.status(500).json({
      error: 'Failed to send recording ready notifications'
    });
  }
});

// Create custom notification
router.post('/create', authMiddleware, [
  body('userId').notEmpty(),
  body('type').notEmpty(),
  body('title').isLength({ min: 1, max: 200 }),
  body('message').isLength({ min: 1, max: 1000 }),
  body('data').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { userId, type, title, message, data } = req.body;
    const notificationManager = req.app.locals.notificationManager;

    const notification = await notificationManager.createNotification(
      userId,
      type,
      title,
      message,
      data
    );

    logger.info(`Custom notification created: ${notification.id} for user ${userId}`);

    res.status(201).json({
      message: 'Notification created successfully',
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        createdAt: notification.createdAt
      }
    });

  } catch (error) {
    logger.error('Create notification error:', error);
    res.status(500).json({
      error: 'Failed to create notification'
    });
  }
});

// Get notification statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const notificationManager = req.app.locals.notificationManager;
    const notifications = await notificationManager.getUserNotifications(req.user.userId);

    const stats = {
      total: notifications.length,
      unread: notifications.filter(n => !n.isRead).length,
      read: notifications.filter(n => n.isRead).length,
      byType: {},
      recent: notifications.slice(0, 5).map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        isRead: n.isRead,
        createdAt: n.createdAt
      }))
    };

    // Count by type
    notifications.forEach(n => {
      stats.byType[n.type] = (stats.byType[n.type] || 0) + 1;
    });

    res.json(stats);

  } catch (error) {
    logger.error('Get notification stats error:', error);
    res.status(500).json({
      error: 'Failed to get notification statistics'
    });
  }
});

module.exports = router;