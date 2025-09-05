const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;
const config = require('../../config/config');
const logger = require('../../config/logger');
const database = require('../../config/database');
const redisClient = require('../../config/redis');
const recordingRoutes = require('./routes/recordings');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.security.corsOrigins,
  credentials: true
}));

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', recordingRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Recording Service',
    timestamp: new Date().toISOString()
  });
});

// Create recording directories
const createRecordingDirs = async () => {
  const dirs = [
    config.fileUpload.recordingPath,
    path.join(config.fileUpload.recordingPath, 'video'),
    path.join(config.fileUpload.recordingPath, 'audio'),
    path.join(config.fileUpload.recordingPath, 'temp')
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create directory ${dir}:`, error);
    }
  }
};

// Mock recording functionality (in production, would integrate with FFmpeg)
const recordingManager = {
  activeRecordings: new Map(),
  
  startRecording: (meetingId, options = {}) => {
    const recordingId = require('uuid').v4();
    const recording = {
      recordingId,
      meetingId,
      status: 'recording',
      startTime: new Date(),
      format: options.format || 'mp4',
      quality: options.quality || 'medium',
      includeAudio: options.includeAudio !== false,
      includeVideo: options.includeVideo !== false,
      includeScreenShare: options.includeScreenShare || false
    };

    recordingManager.activeRecordings.set(recordingId, recording);
    
    logger.info(`Recording started: ${recordingId} for meeting ${meetingId}`);
    
    // In a real implementation, this would start the actual recording process
    // using FFmpeg or a similar tool
    
    return recording;
  },
  
  stopRecording: async (recordingId) => {
    const recording = recordingManager.activeRecordings.get(recordingId);
    
    if (!recording) {
      throw new Error('Recording not found');
    }
    
    recording.status = 'processing';
    recording.endTime = new Date();
    recording.duration = recording.endTime - recording.startTime;
    
    logger.info(`Recording stopped: ${recordingId}`);
    
    // Simulate processing time
    setTimeout(async () => {
      recording.status = 'completed';
      recording.filePath = path.join(
        config.fileUpload.recordingPath,
        'video',
        `recording-${recordingId}.${recording.format}`
      );
      recording.fileSize = Math.floor(Math.random() * 100000000); // Mock file size
      
      // Remove from active recordings
      recordingManager.activeRecordings.delete(recordingId);
      
      logger.info(`Recording processed: ${recordingId}`);
      
      // In a real implementation, you would save to database here
    }, 5000); // 5 second processing simulation
    
    return recording;
  },
  
  getRecording: (recordingId) => {
    return recordingManager.activeRecordings.get(recordingId);
  },
  
  pauseRecording: (recordingId) => {
    const recording = recordingManager.activeRecordings.get(recordingId);
    if (recording) {
      recording.status = 'paused';
      recording.pausedAt = new Date();
      logger.info(`Recording paused: ${recordingId}`);
    }
    return recording;
  },
  
  resumeRecording: (recordingId) => {
    const recording = recordingManager.activeRecordings.get(recordingId);
    if (recording) {
      recording.status = 'recording';
      recording.resumedAt = new Date();
      logger.info(`Recording resumed: ${recordingId}`);
    }
    return recording;
  }
};

// Export recording manager for use in routes
app.locals.recordingManager = recordingManager;

// Error handler
app.use((err, req, res, next) => {
  logger.error('Recording Service error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = config.ports.recordingService;

const startServer = async () => {
  try {
    // Create recording directories
    await createRecordingDirs();
    
    // Connect to databases
    await database.connect('recordings', config.databases.recordings);
    await redisClient.connect();
    
    const server = app.listen(PORT, () => {
      logger.info(`Recording Service running on http://localhost:${PORT}`);
      logger.info(`Recording directory: ${config.fileUpload.recordingPath}`);
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down Recording Service...');
      
      // Stop all active recordings
      for (const [recordingId, recording] of recordingManager.activeRecordings) {
        if (recording.status === 'recording') {
          recordingManager.stopRecording(recordingId);
        }
      }
      
      server.close(async () => {
        await database.closeAllConnections();
        await redisClient.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start Recording Service:', error);
    process.exit(1);
  }
};

startServer();