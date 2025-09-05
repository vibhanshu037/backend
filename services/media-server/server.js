const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const config = require('../../config/config');
const logger = require('../../config/logger');
const database = require('../../config/database');
const redisClient = require('../../config/redis');
const meetingRoutes = require('./routes/meetings');
const { authMiddleware } = require('../../middleware/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: config.security.corsOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

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
app.use('/api', meetingRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Media Server',
    timestamp: new Date().toISOString(),
    activeConnections: io.engine.clientsCount
  });
});

// Store active meetings and participants
const activeMeetings = new Map();
const participantSockets = new Map();

// WebRTC signaling server
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Join meeting room
  socket.on('join-meeting', async (data) => {
    try {
      const { meetingId, userId, userName, userAvatar } = data;
      
      if (!meetingId || !userId) {
        socket.emit('error', { message: 'Meeting ID and User ID are required' });
        return;
      }

      // Join socket room
      socket.join(meetingId);
      
      // Store participant info
      const participantInfo = {
        socketId: socket.id,
        userId,
        userName,
        userAvatar,
        meetingId,
        joinedAt: new Date(),
        isAudioMuted: false,
        isVideoMuted: false,
        isScreenSharing: false
      };

      participantSockets.set(socket.id, participantInfo);

      // Update meeting participants
      if (!activeMeetings.has(meetingId)) {
        activeMeetings.set(meetingId, {
          participants: new Map(),
          createdAt: new Date(),
          hostId: userId
        });
      }

      const meeting = activeMeetings.get(meetingId);
      meeting.participants.set(userId, participantInfo);

      // Notify other participants
      socket.to(meetingId).emit('user-joined', {
        userId,
        userName,
        userAvatar,
        participantCount: meeting.participants.size
      });

      // Send current participants to new user
      const currentParticipants = Array.from(meeting.participants.values())
        .filter(p => p.userId !== userId)
        .map(p => ({
          userId: p.userId,
          userName: p.userName,
          userAvatar: p.userAvatar,
          isAudioMuted: p.isAudioMuted,
          isVideoMuted: p.isVideoMuted,
          isScreenSharing: p.isScreenSharing
        }));

      socket.emit('meeting-joined', {
        participants: currentParticipants,
        participantCount: meeting.participants.size,
        meetingId
      });

      logger.info(`User ${userId} joined meeting ${meetingId}`);

    } catch (error) {
      logger.error('Join meeting error:', error);
      socket.emit('error', { message: 'Failed to join meeting' });
    }
  });

  // WebRTC offer
  socket.on('offer', (data) => {
    const { targetUserId, offer, meetingId } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      // Find target user's socket
      const meeting = activeMeetings.get(meetingId);
      if (meeting) {
        const targetParticipant = Array.from(meeting.participants.values())
          .find(p => p.userId === targetUserId);
        
        if (targetParticipant) {
          io.to(targetParticipant.socketId).emit('offer', {
            fromUserId: participant.userId,
            fromUserName: participant.userName,
            offer
          });
        }
      }
    }
  });

  // WebRTC answer
  socket.on('answer', (data) => {
    const { targetUserId, answer, meetingId } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      const meeting = activeMeetings.get(meetingId);
      if (meeting) {
        const targetParticipant = Array.from(meeting.participants.values())
          .find(p => p.userId === targetUserId);
        
        if (targetParticipant) {
          io.to(targetParticipant.socketId).emit('answer', {
            fromUserId: participant.userId,
            answer
          });
        }
      }
    }
  });

  // ICE candidate
  socket.on('ice-candidate', (data) => {
    const { targetUserId, candidate, meetingId } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      const meeting = activeMeetings.get(meetingId);
      if (meeting) {
        const targetParticipant = Array.from(meeting.participants.values())
          .find(p => p.userId === targetUserId);
        
        if (targetParticipant) {
          io.to(targetParticipant.socketId).emit('ice-candidate', {
            fromUserId: participant.userId,
            candidate
          });
        }
      }
    }
  });

  // Toggle audio
  socket.on('toggle-audio', (data) => {
    const { meetingId, isAudioMuted } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      participant.isAudioMuted = isAudioMuted;
      
      socket.to(meetingId).emit('participant-audio-toggle', {
        userId: participant.userId,
        isAudioMuted
      });
    }
  });

  // Toggle video
  socket.on('toggle-video', (data) => {
    const { meetingId, isVideoMuted } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      participant.isVideoMuted = isVideoMuted;
      
      socket.to(meetingId).emit('participant-video-toggle', {
        userId: participant.userId,
        isVideoMuted
      });
    }
  });

  // Screen share
  socket.on('start-screen-share', (data) => {
    const { meetingId } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      participant.isScreenSharing = true;
      
      socket.to(meetingId).emit('screen-share-started', {
        userId: participant.userId,
        userName: participant.userName
      });
    }
  });

  socket.on('stop-screen-share', (data) => {
    const { meetingId } = data;
    const participant = participantSockets.get(socket.id);
    
    if (participant) {
      participant.isScreenSharing = false;
      
      socket.to(meetingId).emit('screen-share-stopped', {
        userId: participant.userId
      });
    }
  });

  // Leave meeting
  socket.on('leave-meeting', () => {
    handleParticipantLeave(socket);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
    handleParticipantLeave(socket);
  });

  // Error handling
  socket.on('error', (error) => {
    logger.error(`Socket error for ${socket.id}:`, error);
  });
});

function handleParticipantLeave(socket) {
  const participant = participantSockets.get(socket.id);
  
  if (participant) {
    const { meetingId, userId } = participant;
    
    // Remove from meeting
    const meeting = activeMeetings.get(meetingId);
    if (meeting) {
      meeting.participants.delete(userId);
      
      // Notify other participants
      socket.to(meetingId).emit('user-left', {
        userId,
        participantCount: meeting.participants.size
      });

      // Clean up empty meetings
      if (meeting.participants.size === 0) {
        activeMeetings.delete(meetingId);
      }
    }

    // Remove participant
    participantSockets.delete(socket.id);
    
    logger.info(`User ${userId} left meeting ${meetingId}`);
  }
}

// Error handler
app.use((err, req, res, next) => {
  logger.error('Media Server error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = config.ports.mediaServer;

const startServer = async () => {
  try {
    // Connect to databases
    await database.connect('meetings', config.databases.meetings);
    await redisClient.connect();
    
    server.listen(PORT, () => {
      logger.info(`Media Server running on http://localhost:${PORT}`);
      logger.info('WebRTC signaling server ready');
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down Media Server...');
      server.close(async () => {
        await database.closeAllConnections();
        await redisClient.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start Media Server:', error);
    process.exit(1);
  }
};

startServer();