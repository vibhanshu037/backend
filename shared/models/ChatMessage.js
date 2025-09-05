const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  meetingId: {
    type: String,
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // null for public messages
  },
  messageType: {
    type: String,
    enum: ['text', 'file', 'emoji', 'system', 'poll', 'qa'],
    default: 'text'
  },
  content: {
    text: String,
    file: {
      fileName: String,
      fileSize: Number,
      fileType: String,
      fileUrl: String
    },
    emoji: String,
    systemMessage: String,
    poll: {
      pollId: String,
      question: String,
      options: [String]
    },
    qa: {
      questionId: String,
      question: String
    }
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    content: String,
    editedAt: { type: Date, default: Date.now }
  }],
  reactions: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: String,
    reactedAt: { type: Date, default: Date.now }
  }],
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

chatMessageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

chatMessageSchema.index({ meetingId: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1 });
chatMessageSchema.index({ recipient: 1 });
chatMessageSchema.index({ messageType: 1 });

module.exports = chatMessageSchema;