const redis = require('redis');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('The server refused the connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      await this.client.connect();
      this.isConnected = true;
      logger.info('Redis connected successfully');
      
      this.client.on('error', (err) => {
        logger.error('Redis error:', err);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        logger.warn('Redis connection ended');
        this.isConnected = false;
      });

      return this.client;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }

  getClient() {
    return this.client;
  }

  isClientConnected() {
    return this.isConnected;
  }

  // Cache management methods
  async set(key, value, expiration = 3600) {
    if (!this.isConnected) {
      logger.warn('Redis not connected, skipping cache set');
      return null;
    }
    try {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
      return await this.client.setEx(key, expiration, stringValue);
    } catch (error) {
      logger.error('Redis set error:', error);
      return null;
    }
  }

  async get(key) {
    if (!this.isConnected) {
      logger.warn('Redis not connected, skipping cache get');
      return null;
    }
    try {
      const value = await this.client.get(key);
      if (value) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      logger.warn('Redis not connected, skipping cache delete');
      return null;
    }
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error('Redis delete error:', error);
      return null;
    }
  }

  async exists(key) {
    if (!this.isConnected) {
      return false;
    }
    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error('Redis exists error:', error);
      return false;
    }
  }
}

module.exports = new RedisClient();