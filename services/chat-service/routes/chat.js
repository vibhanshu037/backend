const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../../../middleware/auth');
const database = require('../../../config/database');
const logger = require('../../../config/logger');
const chatMessageSchema = require('../../../shared/models/ChatMessage');

const router = express.Router();

// Get ChatMessage model
const getChatMessageModel = () => {
  const connection = database.getConnection('chat');
  return connection.model('ChatMessage', chatMessageSchema);
};

// Get chat history for a meeting
router.get('/messages/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    
    const ChatMessage = getChatMessageModel();
    
    const query = { 
      meetingId,
      isDeleted: false,
      $or: [
        { isPrivate: false },
        { 
          isPrivate: true, 
          $or: [
            { sender: req.user.userId },
            { recipient: req.user.userId }
          ]
        }
      ]
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await ChatMessage.find(query)
      .populate('sender', 'firstName lastName username avatar')
      .populate('recipient', 'firstName lastName username avatar')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((page - 1) * limit);

    const total = await ChatMessage.countDocuments(query);

    res.json({
      messages: messages.reverse().map(msg => ({
        messageId: msg.messageId,
        sender: msg.sender,
        recipient: msg.recipient,
        content: msg.content,
        messageType: msg.messageType,
        isPrivate: msg.isPrivate,
        reactions: msg.reactions,
        mentions: msg.mentions,
        createdAt: msg.createdAt,
        editHistory: msg.editHistory
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalMessages: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get chat messages error:', error);
    res.status(500).json({
      error: 'Failed to get chat messages'
    });
  }
});

// Send message (REST endpoint for persistence)
router.post('/messages', authMiddleware, [
  body('meetingId').notEmpty(),
  body('content.text').optional().isLength({ min: 1, max: 2000 }),
  body('messageType').isIn(['text', 'file', 'emoji', 'system']),
  body('isPrivate').optional().isBoolean(),
  body('recipient').optional().isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { meetingId, content, messageType, isPrivate, recipient } = req.body;
    const ChatMessage = getChatMessageModel();

    const messageId = require('uuid').v4();
    
    const message = new ChatMessage({
      messageId,
      meetingId,
      sender: req.user.userId,
      recipient: isPrivate ? recipient : null,
      messageType,
      content,
      isPrivate: isPrivate || false
    });

    await message.save();

    // Populate sender info
    await message.populate('sender', 'firstName lastName username avatar');
    if (recipient) {
      await message.populate('recipient', 'firstName lastName username avatar');
    }

    logger.info(`Message saved: ${messageId} in meeting ${meetingId}`);

    res.status(201).json({
      message: 'Message sent successfully',
      data: {
        messageId: message.messageId,
        sender: message.sender,
        recipient: message.recipient,
        content: message.content,
        messageType: message.messageType,
        isPrivate: message.isPrivate,
        createdAt: message.createdAt
      }
    });

  } catch (error) {
    logger.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to send message'
    });
  }
});

// Edit message
router.put('/messages/:messageId', authMiddleware, [
  body('content.text').isLength({ min: 1, max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { messageId } = req.params;
    const { content } = req.body;
    const ChatMessage = getChatMessageModel();

    const message = await ChatMessage.findOne({ messageId });
    
    if (!message) {
      return res.status(404).json({
        error: 'Message not found'
      });
    }

    // Check if user is the sender
    if (message.sender.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'You can only edit your own messages'
      });
    }

    // Add to edit history
    message.editHistory.push({
      content: message.content,
      editedAt: new Date()
    });

    // Update content
    message.content = content;
    await message.save();

    logger.info(`Message edited: ${messageId} by ${req.user.userId}`);

    res.json({
      message: 'Message updated successfully',
      data: {
        messageId: message.messageId,
        content: message.content,
        editHistory: message.editHistory,
        updatedAt: message.updatedAt
      }
    });

  } catch (error) {
    logger.error('Edit message error:', error);
    res.status(500).json({
      error: 'Failed to edit message'
    });
  }
});

// Delete message
router.delete('/messages/:messageId', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const ChatMessage = getChatMessageModel();

    const message = await ChatMessage.findOne({ messageId });
    
    if (!message) {
      return res.status(404).json({
        error: 'Message not found'
      });
    }

    // Check if user is the sender
    if (message.sender.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'You can only delete your own messages'
      });
    }

    // Soft delete
    message.isDeleted = true;
    await message.save();

    logger.info(`Message deleted: ${messageId} by ${req.user.userId}`);

    res.json({
      message: 'Message deleted successfully'
    });

  } catch (error) {
    logger.error('Delete message error:', error);
    res.status(500).json({
      error: 'Failed to delete message'
    });
  }
});

// Add reaction to message
router.post('/messages/:messageId/reactions', authMiddleware, [
  body('emoji').notEmpty().isLength({ min: 1, max: 10 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { messageId } = req.params;
    const { emoji } = req.body;
    const ChatMessage = getChatMessageModel();

    const message = await ChatMessage.findOne({ messageId });
    
    if (!message) {
      return res.status(404).json({
        error: 'Message not found'
      });
    }

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(
      r => r.user.toString() === req.user.userId && r.emoji === emoji
    );

    if (existingReaction) {
      return res.status(400).json({
        error: 'You have already reacted with this emoji'
      });
    }

    // Add reaction
    message.reactions.push({
      user: req.user.userId,
      emoji,
      reactedAt: new Date()
    });

    await message.save();

    logger.info(`Reaction added to message ${messageId} by ${req.user.userId}`);

    res.json({
      message: 'Reaction added successfully',
      reactions: message.reactions
    });

  } catch (error) {
    logger.error('Add reaction error:', error);
    res.status(500).json({
      error: 'Failed to add reaction'
    });
  }
});

// Remove reaction from message
router.delete('/messages/:messageId/reactions/:emoji', authMiddleware, async (req, res) => {
  try {
    const { messageId, emoji } = req.params;
    const ChatMessage = getChatMessageModel();

    const message = await ChatMessage.findOne({ messageId });
    
    if (!message) {
      return res.status(404).json({
        error: 'Message not found'
      });
    }

    // Remove reaction
    message.reactions = message.reactions.filter(
      r => !(r.user.toString() === req.user.userId && r.emoji === emoji)
    );

    await message.save();

    logger.info(`Reaction removed from message ${messageId} by ${req.user.userId}`);

    res.json({
      message: 'Reaction removed successfully',
      reactions: message.reactions
    });

  } catch (error) {
    logger.error('Remove reaction error:', error);
    res.status(500).json({
      error: 'Failed to remove reaction'
    });
  }
});

// Mark messages as read
router.post('/messages/read', authMiddleware, [
  body('messageIds').isArray({ min: 1 }),
  body('messageIds.*').isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { messageIds } = req.body;
    const ChatMessage = getChatMessageModel();

    await ChatMessage.updateMany(
      { 
        messageId: { $in: messageIds },
        'readBy.user': { $ne: req.user.userId }
      },
      {
        $push: {
          readBy: {
            user: req.user.userId,
            readAt: new Date()
          }
        }
      }
    );

    logger.info(`Messages marked as read by ${req.user.userId}`);

    res.json({
      message: 'Messages marked as read successfully'
    });

  } catch (error) {
    logger.error('Mark messages as read error:', error);
    res.status(500).json({
      error: 'Failed to mark messages as read'
    });
  }
});

module.exports = router;