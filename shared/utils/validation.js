const { v4: uuidv4 } = require('uuid');

class ValidationUtil {
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidPassword(password) {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  }

  static isValidUsername(username) {
    // 3-30 characters, alphanumeric and underscores only
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    return usernameRegex.test(username);
  }

  static isValidMeetingId(meetingId) {
    // Format: timestamp-randomstring
    const meetingIdRegex = /^[a-z0-9]+-[a-z0-9]+$/;
    return meetingIdRegex.test(meetingId);
  }

  static isValidPhoneNumber(phone) {
    // International phone number format
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
  }

  static sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[<>]/g, '');
  }

  static sanitizeFileName(fileName) {
    if (typeof fileName !== 'string') return '';
    return fileName.replace(/[^a-zA-Z0-9\.\-_]/g, '_');
  }

  static generateUniqueId() {
    return uuidv4();
  }

  static generateShortId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static isValidFileType(mimeType, allowedTypes) {
    return allowedTypes.includes(mimeType);
  }

  static formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  static isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
  }

  static isValidTimezone(timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch (ex) {
      return false;
    }
  }

  static validateMeetingSettings(settings) {
    const errors = [];

    if (settings.maxParticipants && (settings.maxParticipants < 1 || settings.maxParticipants > 1000)) {
      errors.push('Max participants must be between 1 and 1000');
    }

    if (settings.password && settings.requirePassword && settings.password.length < 4) {
      errors.push('Meeting password must be at least 4 characters');
    }

    return errors;
  }

  static validateSchedule(schedule) {
    const errors = [];

    if (schedule.startTime && schedule.endTime) {
      const startTime = new Date(schedule.startTime);
      const endTime = new Date(schedule.endTime);

      if (startTime >= endTime) {
        errors.push('End time must be after start time');
      }

      if (startTime < new Date()) {
        errors.push('Start time cannot be in the past');
      }

      const duration = endTime - startTime;
      const maxDuration = 8 * 60 * 60 * 1000; // 8 hours
      if (duration > maxDuration) {
        errors.push('Meeting duration cannot exceed 8 hours');
      }
    }

    if (schedule.timezone && !this.isValidTimezone(schedule.timezone)) {
      errors.push('Invalid timezone');
    }

    return errors;
  }

  static escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = ValidationUtil;