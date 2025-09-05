const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true, 
    minlength: 3, 
    maxlength: 30 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true, 
    lowercase: true, 
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'] 
  },
  password: { 
    type: String, 
    required: true, 
    minlength: 6 
  },
  firstName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  lastName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  phone: { 
    type: String, 
    trim: true 
  },
  avatar: { 
    type: String, 
    default: null 
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'busy', 'away'],
    default: 'offline'
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: { 
    type: Date 
  },
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sound: { type: Boolean, default: true }
    },
    video: {
      defaultCamera: { type: Boolean, default: true },
      defaultMicrophone: { type: Boolean, default: true },
      quality: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
    },
    privacy: {
      showOnlineStatus: { type: Boolean, default: true },
      allowDirectMessages: { type: Boolean, default: true }
    }
  },
  loginAttempts: {
    count: { type: Number, default: 0 },
    lockedUntil: { type: Date }
  },
  refreshTokens: [{
    token: String,
    createdAt: { type: Date, default: Date.now },
    expiresAt: Date,
    deviceInfo: String
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

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function() {
  return !!(this.loginAttempts && this.loginAttempts.lockedUntil && this.loginAttempts.lockedUntil > Date.now());
};

userSchema.methods.incrementLoginAttempts = function() {
  if (this.loginAttempts.lockedUntil && this.loginAttempts.lockedUntil < Date.now()) {
    return this.updateOne({
      $unset: { 'loginAttempts.lockedUntil': 1 },
      $set: { 'loginAttempts.count': 1 }
    });
  }

  const updates = { $inc: { 'loginAttempts.count': 1 } };
  
  if (this.loginAttempts.count + 1 >= 5 && !this.isLocked()) {
    updates.$set = { 'loginAttempts.lockedUntil': Date.now() + 30 * 60 * 1000 }; // 30 minutes
  }
  
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: { 'loginAttempts.count': 1, 'loginAttempts.lockedUntil': 1 }
  });
};

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

module.exports = userSchema;