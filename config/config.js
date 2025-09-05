module.exports = {
  // Database configuration
  databases: {
    main: process.env.MONGODB_URI || 'mongodb://localhost:27017/video_conference_main',
    users: process.env.USER_DB_URI || 'mongodb://localhost:27017/video_conference_users',
    meetings: process.env.MEETING_DB_URI || 'mongodb://localhost:27017/video_conference_meetings',
    chat: process.env.CHAT_DB_URI || 'mongodb://localhost:27017/video_conference_chat',
    files: process.env.FILE_DB_URI || 'mongodb://localhost:27017/video_conference_files',
    recordings: process.env.RECORDING_DB_URI || 'mongodb://localhost:27017/video_conference_recordings'
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    ttl: {
      session: 60 * 60 * 24, // 24 hours
      cache: 60 * 60, // 1 hour
      meeting: 60 * 60 * 4, // 4 hours
      rtc: 60 * 30 // 30 minutes
    }
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: process.env.JWT_EXPIRE || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  },

  // Server ports for microservices
  ports: {
    apiGateway: process.env.API_GATEWAY_PORT || 3000,
    mediaServer: process.env.MEDIA_SERVER_PORT || 3001,
    chatService: process.env.CHAT_SERVICE_PORT || 3002,
    userService: process.env.USER_SERVICE_PORT || 3003,
    recordingService: process.env.RECORDING_SERVICE_PORT || 3004,
    notificationService: process.env.NOTIFICATION_SERVICE_PORT || 3005,
    fileService: process.env.FILE_SERVICE_PORT || 3006
  },

  // WebRTC configuration
  webrtc: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: process.env.TURN_SERVER_URL || 'turn:localhost:3478',
        username: process.env.TURN_USERNAME || 'username',
        credential: process.env.TURN_PASSWORD || 'password'
      }
    ],
    constraints: {
      video: {
        width: { min: 320, ideal: 1280, max: 1920 },
        height: { min: 240, ideal: 720, max: 1080 },
        frameRate: { min: 15, ideal: 30, max: 60 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }
  },

  // File upload configuration
  fileUpload: {
    maxFileSize: 100 * 1024 * 1024, // 100MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    uploadPath: process.env.UPLOAD_PATH || './uploads',
    recordingPath: process.env.RECORDING_PATH || './recordings'
  },

  // Rate limiting
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
  },

  // Email configuration (for notifications)
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS || ''
    }
  },

  // Meeting configuration
  meeting: {
    maxParticipants: process.env.MAX_PARTICIPANTS || 100,
    defaultDuration: 60 * 60 * 1000, // 1 hour in milliseconds
    maxDuration: 8 * 60 * 60 * 1000, // 8 hours in milliseconds
    waitingRoomEnabled: true,
    recordingEnabled: true,
    chatEnabled: true,
    screenShareEnabled: true,
    whiteboardEnabled: true,
    breakoutRoomsEnabled: true
  },

  // Security configuration
  security: {
    passwordMinLength: 8,
    maxLoginAttempts: 5,
    lockoutTime: 30 * 60 * 1000, // 30 minutes
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret',
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:3001']
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: '14d',
    maxSize: '20m'
  }
};