const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  fileId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  originalName: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    enum: ['image', 'document', 'audio', 'video', 'other'],
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  meetingId: {
    type: String,
    index: true
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  sharedWith: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    sharedAt: { type: Date, default: Date.now },
    permissions: {
      view: { type: Boolean, default: true },
      download: { type: Boolean, default: true },
      edit: { type: Boolean, default: false }
    }
  }],
  metadata: {
    dimensions: {
      width: Number,
      height: Number
    },
    duration: Number, // for audio/video files
    pages: Number, // for documents
    compression: String,
    thumbnail: String
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  lastDownloaded: Date,
  tags: [String],
  description: String,
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  expiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

fileSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

fileSchema.index({ uploadedBy: 1 });
fileSchema.index({ meetingId: 1 });
fileSchema.index({ fileType: 1 });
fileSchema.index({ createdAt: -1 });
fileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = fileSchema;