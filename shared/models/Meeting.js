const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  meetingId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    maxlength: 1000
  },
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coHosts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: Date,
    role: {
      type: String,
      enum: ['host', 'co-host', 'participant', 'viewer'],
      default: 'participant'
    },
    permissions: {
      audio: { type: Boolean, default: true },
      video: { type: Boolean, default: true },
      chat: { type: Boolean, default: true },
      screenShare: { type: Boolean, default: false },
      whiteboard: { type: Boolean, default: false }
    }
  }],
  waitingRoom: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    requestMessage: String
  }],
  settings: {
    isPublic: { type: Boolean, default: false },
    requirePassword: { type: Boolean, default: false },
    password: String,
    waitingRoomEnabled: { type: Boolean, default: true },
    participantVideo: { type: Boolean, default: true },
    participantAudio: { type: Boolean, default: true },
    chatEnabled: { type: Boolean, default: true },
    screenShareEnabled: { type: Boolean, default: true },
    recordingEnabled: { type: Boolean, default: false },
    whiteboardEnabled: { type: Boolean, default: true },
    breakoutRoomsEnabled: { type: Boolean, default: true },
    maxParticipants: { type: Number, default: 100 },
    autoRecord: { type: Boolean, default: false },
    muteOnEntry: { type: Boolean, default: false },
    disableVideo: { type: Boolean, default: false }
  },
  schedule: {
    startTime: Date,
    endTime: Date,
    timezone: String,
    recurring: {
      isRecurring: { type: Boolean, default: false },
      pattern: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        default: 'weekly'
      },
      interval: { type: Number, default: 1 },
      daysOfWeek: [Number], // 0-6, Sunday to Saturday
      endDate: Date
    }
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'ended', 'cancelled'],
    default: 'scheduled'
  },
  recording: {
    isRecording: { type: Boolean, default: false },
    recordingId: String,
    startedAt: Date,
    stoppedAt: Date,
    files: [{
      type: String,
      format: String,
      size: Number,
      duration: Number,
      path: String,
      createdAt: { type: Date, default: Date.now }
    }]
  },
  breakoutRooms: [{
    roomId: String,
    name: String,
    participants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    isActive: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  polls: [{
    pollId: String,
    question: String,
    options: [String],
    responses: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      answer: String,
      answeredAt: { type: Date, default: Date.now }
    }],
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
  }],
  qa: [{
    questionId: String,
    question: String,
    askedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    answer: String,
    answeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isAnswered: { type: Boolean, default: false },
    upvotes: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    askedAt: { type: Date, default: Date.now },
    answeredAt: Date
  }],
  analytics: {
    totalParticipants: { type: Number, default: 0 },
    peakParticipants: { type: Number, default: 0 },
    averageDuration: Number,
    chatMessages: { type: Number, default: 0 },
    screenShares: { type: Number, default: 0 },
    pollsCreated: { type: Number, default: 0 },
    qaQuestions: { type: Number, default: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  startedAt: Date,
  endedAt: Date
});

meetingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

meetingSchema.index({ meetingId: 1 });
meetingSchema.index({ host: 1 });
meetingSchema.index({ status: 1 });
meetingSchema.index({ 'schedule.startTime': 1 });
meetingSchema.index({ createdAt: -1 });

module.exports = meetingSchema;