const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../../../middleware/auth');
const logger = require('../../../config/logger');

const router = express.Router();

// Start recording
router.post('/start', authMiddleware, [
  body('meetingId').notEmpty(),
  body('format').optional().isIn(['mp4', 'webm', 'avi']),
  body('quality').optional().isIn(['low', 'medium', 'high']),
  body('includeAudio').optional().isBoolean(),
  body('includeVideo').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingId, format, quality, includeAudio, includeVideo, includeScreenShare } = req.body;
    const recordingManager = req.app.locals.recordingManager;

    // Check if recording is already active for this meeting
    const existingRecording = Array.from(recordingManager.activeRecordings.values())
      .find(r => r.meetingId === meetingId && r.status === 'recording');

    if (existingRecording) {
      return res.status(400).json({
        error: 'Recording already active',
        message: 'A recording is already in progress for this meeting',
        recordingId: existingRecording.recordingId
      });
    }

    const recording = recordingManager.startRecording(meetingId, {
      format: format || 'mp4',
      quality: quality || 'medium',
      includeAudio: includeAudio !== false,
      includeVideo: includeVideo !== false,
      includeScreenShare: includeScreenShare || false,
      startedBy: req.user.userId
    });

    logger.info(`Recording started: ${recording.recordingId} for meeting ${meetingId} by ${req.user.userId}`);

    res.status(201).json({
      message: 'Recording started successfully',
      recording: {
        recordingId: recording.recordingId,
        meetingId: recording.meetingId,
        status: recording.status,
        startTime: recording.startTime,
        format: recording.format,
        quality: recording.quality,
        includeAudio: recording.includeAudio,
        includeVideo: recording.includeVideo,
        includeScreenShare: recording.includeScreenShare
      }
    });

  } catch (error) {
    logger.error('Start recording error:', error);
    res.status(500).json({
      error: 'Failed to start recording'
    });
  }
});

// Stop recording
router.post('/:recordingId/stop', authMiddleware, async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recordingManager = req.app.locals.recordingManager;

    const recording = recordingManager.getRecording(recordingId);
    
    if (!recording) {
      return res.status(404).json({
        error: 'Recording not found'
      });
    }

    if (recording.status !== 'recording' && recording.status !== 'paused') {
      return res.status(400).json({
        error: 'Cannot stop recording',
        message: `Recording is in ${recording.status} status`
      });
    }

    await recordingManager.stopRecording(recordingId);

    logger.info(`Recording stopped: ${recordingId} by ${req.user.userId}`);

    res.json({
      message: 'Recording stopped successfully',
      recording: {
        recordingId: recording.recordingId,
        status: recording.status,
        endTime: recording.endTime,
        duration: recording.duration
      }
    });

  } catch (error) {
    logger.error('Stop recording error:', error);
    res.status(500).json({
      error: 'Failed to stop recording'
    });
  }
});

// Pause recording
router.post('/:recordingId/pause', authMiddleware, async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recordingManager = req.app.locals.recordingManager;

    const recording = recordingManager.pauseRecording(recordingId);
    
    if (!recording) {
      return res.status(404).json({
        error: 'Recording not found'
      });
    }

    if (recording.status !== 'paused') {
      return res.status(400).json({
        error: 'Failed to pause recording'
      });
    }

    logger.info(`Recording paused: ${recordingId} by ${req.user.userId}`);

    res.json({
      message: 'Recording paused successfully',
      recording: {
        recordingId: recording.recordingId,
        status: recording.status,
        pausedAt: recording.pausedAt
      }
    });

  } catch (error) {
    logger.error('Pause recording error:', error);
    res.status(500).json({
      error: 'Failed to pause recording'
    });
  }
});

// Resume recording
router.post('/:recordingId/resume', authMiddleware, async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recordingManager = req.app.locals.recordingManager;

    const recording = recordingManager.resumeRecording(recordingId);
    
    if (!recording) {
      return res.status(404).json({
        error: 'Recording not found'
      });
    }

    if (recording.status !== 'recording') {
      return res.status(400).json({
        error: 'Failed to resume recording'
      });
    }

    logger.info(`Recording resumed: ${recordingId} by ${req.user.userId}`);

    res.json({
      message: 'Recording resumed successfully',
      recording: {
        recordingId: recording.recordingId,
        status: recording.status,
        resumedAt: recording.resumedAt
      }
    });

  } catch (error) {
    logger.error('Resume recording error:', error);
    res.status(500).json({
      error: 'Failed to resume recording'
    });
  }
});

// Get recording status
router.get('/:recordingId/status', authMiddleware, async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recordingManager = req.app.locals.recordingManager;

    const recording = recordingManager.getRecording(recordingId);
    
    if (!recording) {
      return res.status(404).json({
        error: 'Recording not found'
      });
    }

    res.json({
      recording: {
        recordingId: recording.recordingId,
        meetingId: recording.meetingId,
        status: recording.status,
        startTime: recording.startTime,
        endTime: recording.endTime,
        duration: recording.duration,
        format: recording.format,
        quality: recording.quality,
        filePath: recording.filePath,
        fileSize: recording.fileSize,
        includeAudio: recording.includeAudio,
        includeVideo: recording.includeVideo,
        includeScreenShare: recording.includeScreenShare
      }
    });

  } catch (error) {
    logger.error('Get recording status error:', error);
    res.status(500).json({
      error: 'Failed to get recording status'
    });
  }
});

// Get recordings for a meeting
router.get('/meeting/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const recordingManager = req.app.locals.recordingManager;

    // In a real implementation, this would query the database
    // For now, get from active recordings
    const recordings = Array.from(recordingManager.activeRecordings.values())
      .filter(r => r.meetingId === meetingId);

    res.json({
      recordings: recordings.map(recording => ({
        recordingId: recording.recordingId,
        status: recording.status,
        startTime: recording.startTime,
        endTime: recording.endTime,
        duration: recording.duration,
        format: recording.format,
        quality: recording.quality,
        fileSize: recording.fileSize
      }))
    });

  } catch (error) {
    logger.error('Get meeting recordings error:', error);
    res.status(500).json({
      error: 'Failed to get meeting recordings'
    });
  }
});

// Get user's recordings
router.get('/my-recordings', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    // In a real implementation, this would query the database
    // For now, return empty array as recordings would be stored in DB
    const recordings = [];
    const total = 0;

    res.json({
      recordings,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalRecordings: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get user recordings error:', error);
    res.status(500).json({
      error: 'Failed to get recordings'
    });
  }
});

// Download recording
router.get('/:recordingId/download', authMiddleware, async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recordingManager = req.app.locals.recordingManager;

    const recording = recordingManager.getRecording(recordingId);
    
    if (!recording) {
      return res.status(404).json({
        error: 'Recording not found'
      });
    }

    if (recording.status !== 'completed') {
      return res.status(400).json({
        error: 'Recording not ready',
        message: 'Recording is still processing'
      });
    }

    // In a real implementation, this would serve the actual recording file
    res.json({
      message: 'Recording download initiated',
      downloadUrl: `/recordings/serve/${recording.recordingId}.${recording.format}`,
      recording: {
        recordingId: recording.recordingId,
        fileName: `recording-${recording.recordingId}.${recording.format}`,
        fileSize: recording.fileSize,
        duration: recording.duration,
        format: recording.format
      }
    });

    logger.info(`Recording ${recordingId} downloaded by ${req.user.userId}`);

  } catch (error) {
    logger.error('Download recording error:', error);
    res.status(500).json({
      error: 'Failed to download recording'
    });
  }
});

// Delete recording
router.delete('/:recordingId', authMiddleware, async (req, res) => {
  try {
    const { recordingId } = req.params;
    
    // In a real implementation, this would:
    // 1. Check if user has permission to delete
    // 2. Delete from database
    // 3. Delete actual file from storage
    
    logger.info(`Recording ${recordingId} deleted by ${req.user.userId}`);

    res.json({
      message: 'Recording deleted successfully'
    });

  } catch (error) {
    logger.error('Delete recording error:', error);
    res.status(500).json({
      error: 'Failed to delete recording'
    });
  }
});

module.exports = router;