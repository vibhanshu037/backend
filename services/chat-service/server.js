const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const config = require('../../config/config');
const logger = require('../../config/logger');
const database = require('../../config/database');
const redisClient = require('../../config/redis');
const chatRoutes = require('./routes/chat');

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
app.use('/api', chatRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Chat Service',
    timestamp: new Date().toISOString(),
    activeConnections: io.engine.clientsCount
  });
});

// Store active chat users
const activeChatUsers = new Map();
const chatRooms = new Map();

// Chat socket server
io.on('connection', (socket) => {
  logger.info(`Chat socket connected: ${socket.id}`);

  // Join chat room
  socket.on('join-chat-room', async (data) => {
    try {
      const { meetingId, userId, userName, userAvatar } = data;
      
      if (!meetingId || !userId) {
        socket.emit('error', { message: 'Meeting ID and User ID are required' });
        return;
      }

      // Join socket room
      socket.join(`chat:${meetingId}`);
      
      // Store user info
      const userInfo = {
        socketId: socket.id,
        userId,
        userName,
        userAvatar,
        meetingId,
        joinedAt: new Date()
      };

      activeChatUsers.set(socket.id, userInfo);

      // Update chat room
      if (!chatRooms.has(meetingId)) {
        chatRooms.set(meetingId, {
          users: new Map(),
          messageCount: 0,
          createdAt: new Date()
        });
      }

      const chatRoom = chatRooms.get(meetingId);
      chatRoom.users.set(userId, userInfo);

      // Notify others
      socket.to(`chat:${meetingId}`).emit('user-joined-chat', {
        userId,
        userName,
        userAvatar,
        onlineCount: chatRoom.users.size
      });

      // Send current online users to new user
      const onlineUsers = Array.from(chatRoom.users.values())
        .filter(u => u.userId !== userId)
        .map(u => ({
          userId: u.userId,
          userName: u.userName,
          userAvatar: u.userAvatar
        }));

      socket.emit('chat-room-joined', {
        onlineUsers,
        onlineCount: chatRoom.users.size
      });

      logger.info(`User ${userId} joined chat room for meeting ${meetingId}`);

    } catch (error) {
      logger.error('Join chat room error:', error);
      socket.emit('error', { message: 'Failed to join chat room' });
    }
  });

  // Send chat message
  socket.on('send-message', async (data) => {
    try {
      const { meetingId, message, messageType = 'text', isPrivate = false, recipient } = data;
      const user = activeChatUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found in chat room' });
        return;
      }

      const messageId = require('uuid').v4();
      const chatMessage = {
        messageId,
        meetingId,
        sender: {
          userId: user.userId,
          userName: user.userName,
          userAvatar: user.userAvatar
        },
        content: message,
        messageType,
        isPrivate,
        recipient,
        timestamp: new Date(),
        reactions: [],
        mentions: []
      };

      // Store message in database (if needed for persistence)
      // This would use the ChatMessage model

      // Update room message count
      const chatRoom = chatRooms.get(meetingId);
      if (chatRoom) {
        chatRoom.messageCount++;
      }

      if (isPrivate && recipient) {
        // Send private message
        const recipientUser = Array.from(activeChatUsers.values())
          .find(u => u.userId === recipient && u.meetingId === meetingId);
        
        if (recipientUser) {
          // Send to recipient
          io.to(recipientUser.socketId).emit('private-message', chatMessage);
          // Send back to sender
          socket.emit('private-message', chatMessage);
        } else {
          socket.emit('error', { message: 'Recipient not found or offline' });
        }
      } else {
        // Broadcast to all users in the meeting
        io.to(`chat:${meetingId}`).emit('new-message', chatMessage);
      }

      logger.info(`Message sent in meeting ${meetingId} by ${user.userId}`);

    } catch (error) {
      logger.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // React to message
  socket.on('react-to-message', async (data) => {
    try {
      const { meetingId, messageId, emoji } = data;
      const user = activeChatUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found in chat room' });
        return;
      }

      const reaction = {
        userId: user.userId,
        userName: user.userName,
        emoji,
        timestamp: new Date()
      };

      // Broadcast reaction to all users in the meeting
      io.to(`chat:${meetingId}`).emit('message-reaction', {
        messageId,
        reaction
      });

      logger.info(`Reaction added to message ${messageId} by ${user.userId}`);

    } catch (error) {
      logger.error('React to message error:', error);
      socket.emit('error', { message: 'Failed to add reaction' });
    }
  });

  // User typing indicator
  socket.on('typing-start', (data) => {
    const { meetingId } = data;
    const user = activeChatUsers.get(socket.id);
    
    if (user) {
      socket.to(`chat:${meetingId}`).emit('user-typing', {
        userId: user.userId,
        userName: user.userName
      });
    }
  });

  socket.on('typing-stop', (data) => {
    const { meetingId } = data;
    const user = activeChatUsers.get(socket.id);
    
    if (user) {
      socket.to(`chat:${meetingId}`).emit('user-stopped-typing', {
        userId: user.userId
      });
    }
  });

  // Create poll
  socket.on('create-poll', async (data) => {
    try {
      const { meetingId, question, options } = data;
      const user = activeChatUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found in chat room' });
        return;
      }

      const pollId = require('uuid').v4();
      const poll = {
        pollId,
        question,
        options: options.map(option => ({ text: option, votes: 0 })),
        createdBy: {
          userId: user.userId,
          userName: user.userName
        },
        responses: [],
        isActive: true,
        createdAt: new Date()
      };

      // Broadcast poll to all users
      io.to(`chat:${meetingId}`).emit('new-poll', poll);

      logger.info(`Poll created in meeting ${meetingId} by ${user.userId}`);

    } catch (error) {
      logger.error('Create poll error:', error);
      socket.emit('error', { message: 'Failed to create poll' });
    }
  });

  // Vote on poll
  socket.on('vote-poll', async (data) => {
    try {
      const { meetingId, pollId, optionIndex } = data;
      const user = activeChatUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found in chat room' });
        return;
      }

      const vote = {
        userId: user.userId,
        userName: user.userName,
        optionIndex,
        votedAt: new Date()
      };

      // Broadcast vote to all users
      io.to(`chat:${meetingId}`).emit('poll-vote', {
        pollId,
        vote
      });

      logger.info(`Vote cast on poll ${pollId} by ${user.userId}`);

    } catch (error) {
      logger.error('Vote poll error:', error);
      socket.emit('error', { message: 'Failed to vote on poll' });
    }
  });

  // Ask question (Q&A)
  socket.on('ask-question', async (data) => {
    try {
      const { meetingId, question } = data;
      const user = activeChatUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found in chat room' });
        return;
      }

      const questionId = require('uuid').v4();
      const qaQuestion = {
        questionId,
        question,
        askedBy: {
          userId: user.userId,
          userName: user.userName,
          userAvatar: user.userAvatar
        },
        upvotes: [],
        isAnswered: false,
        askedAt: new Date()
      };

      // Broadcast question to all users
      io.to(`chat:${meetingId}`).emit('new-question', qaQuestion);

      logger.info(`Question asked in meeting ${meetingId} by ${user.userId}`);

    } catch (error) {
      logger.error('Ask question error:', error);
      socket.emit('error', { message: 'Failed to ask question' });
    }
  });

  // Upvote question
  socket.on('upvote-question', async (data) => {
    try {
      const { meetingId, questionId } = data;
      const user = activeChatUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found in chat room' });
        return;
      }

      // Broadcast upvote to all users
      io.to(`chat:${meetingId}`).emit('question-upvoted', {
        questionId,
        upvotedBy: user.userId
      });

      logger.info(`Question ${questionId} upvoted by ${user.userId}`);

    } catch (error) {
      logger.error('Upvote question error:', error);
      socket.emit('error', { message: 'Failed to upvote question' });
    }
  });

  // Leave chat room
  socket.on('leave-chat-room', () => {
    handleChatUserLeave(socket);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    logger.info(`Chat socket disconnected: ${socket.id}`);
    handleChatUserLeave(socket);
  });

  // Error handling
  socket.on('error', (error) => {
    logger.error(`Chat socket error for ${socket.id}:`, error);
  });
});

function handleChatUserLeave(socket) {
  const user = activeChatUsers.get(socket.id);
  
  if (user) {
    const { meetingId, userId } = user;
    
    // Remove from chat room
    const chatRoom = chatRooms.get(meetingId);
    if (chatRoom) {
      chatRoom.users.delete(userId);
      
      // Notify other users
      socket.to(`chat:${meetingId}`).emit('user-left-chat', {
        userId,
        onlineCount: chatRoom.users.size
      });

      // Clean up empty chat rooms
      if (chatRoom.users.size === 0) {
        chatRooms.delete(meetingId);
      }
    }

    // Remove user
    activeChatUsers.delete(socket.id);
    
    logger.info(`User ${userId} left chat room for meeting ${meetingId}`);
  }
}

// Error handler
app.use((err, req, res, next) => {
  logger.error('Chat Service error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = config.ports.chatService;

const startServer = async () => {
  try {
    // Connect to databases
    await database.connect('chat', config.databases.chat);
    await redisClient.connect();
    
    server.listen(PORT, () => {
      logger.info(`Chat Service running on http://localhost:${PORT}`);
      logger.info('Chat socket server ready');
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down Chat Service...');
      server.close(async () => {
        await database.closeAllConnections();
        await redisClient.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start Chat Service:', error);
    process.exit(1);
  }
};

startServer();