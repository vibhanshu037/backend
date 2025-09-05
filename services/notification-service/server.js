const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const config = require('../../config/config');
const logger = require('../../config/logger');
const database = require('../../config/database');
const redisClient = require('../../config/redis');
const notificationRoutes = require('./routes/notifications');

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
app.use('/api', notificationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Notification Service',
    timestamp: new Date().toISOString()
  });
});

// Email transporter setup
let emailTransporter = null;

const setupEmailTransporter = () => {
  if (config.email.host && config.email.auth.user && config.email.auth.pass) {
    emailTransporter = nodemailer.createTransporter({
      host: config.email.host,
      port: config.email.port,
      secure: false,
      auth: {
        user: config.email.auth.user,
        pass: config.email.auth.pass
      }
    });
    
    logger.info('Email transporter configured');
  } else {
    logger.warn('Email configuration incomplete, email notifications disabled');
  }
};

// Notification manager
const notificationManager = {
  // In-memory storage for demo (use database in production)
  notifications: new Map(),
  userNotifications: new Map(),
  
  // Send email notification
  sendEmail: async (to, subject, html, text) => {
    if (!emailTransporter) {
      logger.warn('Email transporter not configured');
      return false;
    }
    
    try {
      const info = await emailTransporter.sendMail({
        from: `"Video Conference Platform" <${config.email.auth.user}>`,
        to,
        subject,
        html,
        text
      });
      
      logger.info(`Email sent: ${info.messageId} to ${to}`);
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  },
  
  // Create notification
  createNotification: async (userId, type, title, message, data = {}) => {
    const notificationId = require('uuid').v4();
    const notification = {
      id: notificationId,
      userId,
      type,
      title,
      message,
      data,
      isRead: false,
      createdAt: new Date(),
      expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    };
    
    notificationManager.notifications.set(notificationId, notification);
    
    // Add to user's notifications
    if (!notificationManager.userNotifications.has(userId)) {
      notificationManager.userNotifications.set(userId, []);
    }
    notificationManager.userNotifications.get(userId).push(notificationId);
    
    // Cache in Redis
    await redisClient.set(`notification:${notificationId}`, notification, 30 * 24 * 60 * 60); // 30 days
    
    logger.info(`Notification created: ${notificationId} for user ${userId}`);
    
    return notification;
  },
  
  // Send meeting invitation
  sendMeetingInvitation: async (invitation) => {
    const { inviteeEmail, inviteeName, meetingTitle, meetingId, hostName, startTime, joinUrl } = invitation;
    
    const subject = `Meeting Invitation: ${meetingTitle}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">You're invited to a meeting</h2>
        <p>Hello ${inviteeName},</p>
        <p>${hostName} has invited you to join a video conference meeting.</p>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0; color: #555;">${meetingTitle}</h3>
          <p style="margin: 5px 0;"><strong>Date & Time:</strong> ${new Date(startTime).toLocaleString()}</p>
          <p style="margin: 5px 0;"><strong>Meeting ID:</strong> ${meetingId}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${joinUrl}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Join Meeting</a>
        </div>
        
        <p style="font-size: 14px; color: #666;">
          If you're unable to click the button above, copy and paste this link into your browser:<br>
          <a href="${joinUrl}">${joinUrl}</a>
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 12px; color: #888;">
          This invitation was sent by the Video Conferencing Platform.
        </p>
      </div>
    `;
    
    const text = `
You're invited to a meeting: ${meetingTitle}
Host: ${hostName}
Date & Time: ${new Date(startTime).toLocaleString()}
Meeting ID: ${meetingId}
Join URL: ${joinUrl}
    `;
    
    return await notificationManager.sendEmail(inviteeEmail, subject, html, text);
  },
  
  // Send meeting reminder
  sendMeetingReminder: async (reminder) => {
    const { userEmail, userName, meetingTitle, meetingId, startTime, joinUrl, reminderTime } = reminder;
    
    const subject = `Meeting Reminder: ${meetingTitle} starts in ${reminderTime}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff6b35;">Meeting Reminder</h2>
        <p>Hello ${userName},</p>
        <p>This is a reminder that your meeting <strong>${meetingTitle}</strong> starts in ${reminderTime}.</p>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Meeting:</strong> ${meetingTitle}</p>
          <p style="margin: 5px 0;"><strong>Start Time:</strong> ${new Date(startTime).toLocaleString()}</p>
          <p style="margin: 5px 0;"><strong>Meeting ID:</strong> ${meetingId}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${joinUrl}" style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Join Now</a>
        </div>
      </div>
    `;
    
    return await notificationManager.sendEmail(userEmail, subject, html);
  },
  
  // Send meeting recording notification
  sendRecordingReady: async (notification) => {
    const { userEmail, userName, meetingTitle, recordingUrl, downloadUrl } = notification;
    
    const subject = `Recording Available: ${meetingTitle}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Recording Ready</h2>
        <p>Hello ${userName},</p>
        <p>The recording for your meeting <strong>${meetingTitle}</strong> is now available.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${recordingUrl}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin-right: 10px;">View Recording</a>
          <a href="${downloadUrl}" style="background: #6c757d; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Download</a>
        </div>
        
        <p style="font-size: 14px; color: #666;">
          The recording will be available for 30 days. After that, it will be automatically deleted.
        </p>
      </div>
    `;
    
    return await notificationManager.sendEmail(userEmail, subject, html);
  },
  
  // Get user notifications
  getUserNotifications: async (userId, options = {}) => {
    const userNotificationIds = notificationManager.userNotifications.get(userId) || [];
    const notifications = [];
    
    for (const notificationId of userNotificationIds) {
      let notification = notificationManager.notifications.get(notificationId);
      
      // Try to get from cache if not in memory
      if (!notification) {
        notification = await redisClient.get(`notification:${notificationId}`);
      }
      
      if (notification && notification.expiresAt > new Date()) {
        if (options.unreadOnly && notification.isRead) continue;
        notifications.push(notification);
      }
    }
    
    // Sort by creation date (newest first)
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return notifications;
  },
  
  // Mark notification as read
  markAsRead: async (notificationId) => {
    const notification = notificationManager.notifications.get(notificationId);
    if (notification) {
      notification.isRead = true;
      notification.readAt = new Date();
      
      // Update cache
      await redisClient.set(`notification:${notificationId}`, notification, 30 * 24 * 60 * 60);
    }
  }
};

// Setup email transporter
setupEmailTransporter();

// Export notification manager for use in routes
app.locals.notificationManager = notificationManager;

// Error handler
app.use((err, req, res, next) => {
  logger.error('Notification Service error:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

const PORT = config.ports.notificationService;

const startServer = async () => {
  try {
    // Connect to databases
    await database.connect('notifications', config.databases.main); // Using main DB for notifications
    await redisClient.connect();
    
    const server = app.listen(PORT, () => {
      logger.info(`Notification Service running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down Notification Service...');
      server.close(async () => {
        await database.closeAllConnections();
        await redisClient.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start Notification Service:', error);
    process.exit(1);
  }
};

startServer();