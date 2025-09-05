const jwt = require('jsonwebtoken');
const config = require('../config/config');
const logger = require('../config/logger');

class AuthUtil {
  static generateAccessToken(payload) {
    try {
      return jwt.sign(payload, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
        issuer: 'video-conferencing-platform'
      });
    } catch (error) {
      logger.error('Error generating access token:', error);
      throw new Error('Token generation failed');
    }
  }

  static generateRefreshToken(payload) {
    try {
      return jwt.sign(payload, config.jwt.refreshSecret, {
        expiresIn: config.jwt.refreshExpiresIn,
        issuer: 'video-conferencing-platform'
      });
    } catch (error) {
      logger.error('Error generating refresh token:', error);
      throw new Error('Refresh token generation failed');
    }
  }

  static verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.jwt.secret);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Access token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid access token');
      } else {
        logger.error('Error verifying access token:', error);
        throw new Error('Token verification failed');
      }
    }
  }

  static verifyRefreshToken(token) {
    try {
      return jwt.verify(token, config.jwt.refreshSecret);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Refresh token expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid refresh token');
      } else {
        logger.error('Error verifying refresh token:', error);
        throw new Error('Refresh token verification failed');
      }
    }
  }

  static extractTokenFromHeader(authorization) {
    if (!authorization) {
      throw new Error('Authorization header missing');
    }

    const parts = authorization.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new Error('Invalid authorization header format');
    }

    return parts[1];
  }

  static generateMeetingPassword(length = 8) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static generateMeetingId() {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${randomStr}`;
  }

  static hashPassword(password) {
    const bcrypt = require('bcryptjs');
    return bcrypt.hash(password, 12);
  }

  static comparePassword(password, hashedPassword) {
    const bcrypt = require('bcryptjs');
    return bcrypt.compare(password, hashedPassword);
  }
}

module.exports = AuthUtil;