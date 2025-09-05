const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../../../middleware/auth');
const AuthUtil = require('../../../shared/utils/auth');
const ValidationUtil = require('../../../shared/utils/validation');
const database = require('../../../config/database');
const redisClient = require('../../../config/redis');
const logger = require('../../../config/logger');
const meetingSchema = require('../../../shared/models/Meeting');

const router = express.Router();

// Get Meeting model
const getMeetingModel = () => {
  const connection = database.getConnection('meetings');
  return connection.model('Meeting', meetingSchema);
};

// Create meeting
router.post('/create', authMiddleware, [
  body('title').isLength({ min: 1, max: 200 }).trim(),
  body('description').optional().isLength({ max: 1000 }),
  body('schedule.startTime').optional().isISO8601(),
  body('schedule.endTime').optional().isISO8601(),
  body('settings.maxParticipants').optional().isInt({ min: 1, max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { title, description, schedule, settings } = req.body;
    const Meeting = getMeetingModel();

    // Generate unique meeting ID
    const meetingId = AuthUtil.generateMeetingId();

    // Create meeting
    const meeting = new Meeting({
      meetingId,
      title,
      description,
      host: req.user.userId,
      schedule: {
        startTime: schedule?.startTime || new Date(),
        endTime: schedule?.endTime,
        timezone: schedule?.timezone || 'UTC'
      },
      settings: {
        ...settings,
        password: settings?.requirePassword ? AuthUtil.generateMeetingPassword() : null
      }
    });

    await meeting.save();

    // Cache meeting info
    await redisClient.set(
      `meeting:${meetingId}`,
      {
        id: meeting._id,
        meetingId,
        title: meeting.title,
        hostId: meeting.host,
        settings: meeting.settings,
        status: meeting.status
      },
      3600 // 1 hour
    );

    logger.info(`Meeting created: ${meetingId} by ${req.user.email}`);

    res.status(201).json({
      message: 'Meeting created successfully',
      meeting: {
        id: meeting._id,
        meetingId: meeting.meetingId,
        title: meeting.title,
        description: meeting.description,
        host: meeting.host,
        schedule: meeting.schedule,
        settings: {
          ...meeting.settings,
          password: settings?.requirePassword ? meeting.settings.password : undefined
        },
        status: meeting.status,
        createdAt: meeting.createdAt
      }
    });

  } catch (error) {
    logger.error('Create meeting error:', error);
    res.status(500).json({
      error: 'Failed to create meeting'
    });
  }
});

// Get meeting details
router.get('/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const Meeting = getMeetingModel();

    // First check cache
    let meetingData = await redisClient.get(`meeting:${meetingId}`);
    
    if (!meetingData) {
      // Get from database
      const meeting = await Meeting.findOne({ meetingId })
        .populate('host', 'firstName lastName username email avatar')
        .populate('participants.user', 'firstName lastName username avatar');

      if (!meeting) {
        return res.status(404).json({
          error: 'Meeting not found'
        });
      }

      meetingData = meeting;
      
      // Cache for future requests
      await redisClient.set(`meeting:${meetingId}`, meetingData, 3600);
    }

    // Check if user has access to meeting
    const isHost = meetingData.host._id?.toString() === req.user.userId || meetingData.hostId === req.user.userId;
    const isParticipant = meetingData.participants?.some(p => p.user._id?.toString() === req.user.userId);
    const isPublic = meetingData.settings?.isPublic;

    if (!isHost && !isParticipant && !isPublic) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to view this meeting'
      });
    }

    res.json({
      meeting: {
        id: meetingData._id || meetingData.id,
        meetingId: meetingData.meetingId,
        title: meetingData.title,
        description: meetingData.description,
        host: meetingData.host,
        schedule: meetingData.schedule,
        settings: {
          ...meetingData.settings,
          password: isHost ? meetingData.settings?.password : undefined
        },
        status: meetingData.status,
        participants: meetingData.participants || [],
        createdAt: meetingData.createdAt
      }
    });

  } catch (error) {
    logger.error('Get meeting error:', error);
    res.status(500).json({
      error: 'Failed to get meeting details'
    });
  }
});

// Join meeting
router.post('/:meetingId/join', authMiddleware, [
  body('password').optional().isString()
], async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { password } = req.body;
    const Meeting = getMeetingModel();

    const meeting = await Meeting.findOne({ meetingId });
    
    if (!meeting) {
      return res.status(404).json({
        error: 'Meeting not found'
      });
    }

    // Check meeting status
    if (meeting.status === 'ended') {
      return res.status(400).json({
        error: 'Meeting has ended'
      });
    }

    if (meeting.status === 'cancelled') {
      return res.status(400).json({
        error: 'Meeting has been cancelled'
      });
    }

    // Check password if required
    if (meeting.settings.requirePassword && meeting.settings.password !== password) {
      return res.status(401).json({
        error: 'Invalid meeting password'
      });
    }

    // Check if already a participant
    const existingParticipant = meeting.participants.find(
      p => p.user.toString() === req.user.userId
    );

    if (!existingParticipant) {
      // Add to participants
      meeting.participants.push({
        user: req.user.userId,
        role: 'participant'
      });

      // Update analytics
      meeting.analytics.totalParticipants = Math.max(
        meeting.analytics.totalParticipants,
        meeting.participants.length
      );
      meeting.analytics.peakParticipants = Math.max(
        meeting.analytics.peakParticipants,
        meeting.participants.length
      );

      // Update meeting status to active if not already
      if (meeting.status === 'scheduled') {
        meeting.status = 'active';
        meeting.startedAt = new Date();
      }

      await meeting.save();
    }

    // Update cache
    await redisClient.set(`meeting:${meetingId}`, meeting, 3600);

    logger.info(`User ${req.user.email} joined meeting ${meetingId}`);

    res.json({
      message: 'Successfully joined meeting',
      meeting: {
        id: meeting._id,
        meetingId: meeting.meetingId,
        title: meeting.title,
        host: meeting.host,
        settings: meeting.settings,
        status: meeting.status,
        webrtc: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      }
    });

  } catch (error) {
    logger.error('Join meeting error:', error);
    res.status(500).json({
      error: 'Failed to join meeting'
    });
  }
});

// Leave meeting
router.post('/:meetingId/leave', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const Meeting = getMeetingModel();

    const meeting = await Meeting.findOne({ meetingId });
    
    if (!meeting) {
      return res.status(404).json({
        error: 'Meeting not found'
      });
    }

    // Remove from participants
    const participantIndex = meeting.participants.findIndex(
      p => p.user.toString() === req.user.userId
    );

    if (participantIndex !== -1) {
      meeting.participants[participantIndex].leftAt = new Date();
      await meeting.save();
    }

    // Update cache
    await redisClient.set(`meeting:${meetingId}`, meeting, 3600);

    logger.info(`User ${req.user.email} left meeting ${meetingId}`);

    res.json({
      message: 'Successfully left meeting'
    });

  } catch (error) {
    logger.error('Leave meeting error:', error);
    res.status(500).json({
      error: 'Failed to leave meeting'
    });
  }
});

// End meeting (host only)
router.post('/:meetingId/end', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const Meeting = getMeetingModel();

    const meeting = await Meeting.findOne({ meetingId });
    
    if (!meeting) {
      return res.status(404).json({
        error: 'Meeting not found'
      });
    }

    // Check if user is host
    if (meeting.host.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'Only the host can end the meeting'
      });
    }

    // End meeting
    meeting.status = 'ended';
    meeting.endedAt = new Date();

    // Update all participants leftAt time
    meeting.participants.forEach(participant => {
      if (!participant.leftAt) {
        participant.leftAt = new Date();
      }
    });

    await meeting.save();

    // Update cache
    await redisClient.set(`meeting:${meetingId}`, meeting, 3600);

    logger.info(`Meeting ${meetingId} ended by host ${req.user.email}`);

    res.json({
      message: 'Meeting ended successfully'
    });

  } catch (error) {
    logger.error('End meeting error:', error);
    res.status(500).json({
      error: 'Failed to end meeting'
    });
  }
});

// Get user's meetings
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const Meeting = getMeetingModel();

    const query = {
      $or: [
        { host: req.user.userId },
        { 'participants.user': req.user.userId }
      ]
    };

    if (status) {
      query.status = status;
    }

    const meetings = await Meeting.find(query)
      .populate('host', 'firstName lastName username avatar')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Meeting.countDocuments(query);

    res.json({
      meetings: meetings.map(meeting => ({
        id: meeting._id,
        meetingId: meeting.meetingId,
        title: meeting.title,
        description: meeting.description,
        host: meeting.host,
        schedule: meeting.schedule,
        status: meeting.status,
        participantCount: meeting.participants.length,
        createdAt: meeting.createdAt
      })),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalMeetings: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get meetings error:', error);
    res.status(500).json({
      error: 'Failed to get meetings'
    });
  }
});

// Update meeting settings (host only)
router.put('/:meetingId/settings', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { settings } = req.body;
    const Meeting = getMeetingModel();

    const meeting = await Meeting.findOne({ meetingId });
    
    if (!meeting) {
      return res.status(404).json({
        error: 'Meeting not found'
      });
    }

    // Check if user is host
    if (meeting.host.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'Only the host can update meeting settings'
      });
    }

    // Update settings
    meeting.settings = { ...meeting.settings, ...settings };
    await meeting.save();

    // Update cache
    await redisClient.set(`meeting:${meetingId}`, meeting, 3600);

    logger.info(`Meeting settings updated: ${meetingId} by ${req.user.email}`);

    res.json({
      message: 'Meeting settings updated successfully',
      settings: meeting.settings
    });

  } catch (error) {
    logger.error('Update meeting settings error:', error);
    res.status(500).json({
      error: 'Failed to update meeting settings'
    });
  }
});

module.exports = router;