const mongoose = require('mongoose');
const logger = require('./logger');

class DatabaseConnection {
  constructor() {
    this.connections = {};
  }

  async connect(databaseName, uri) {
    try {
      if (this.connections[databaseName]) {
        return this.connections[databaseName];
      }

      const connectionOptions = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferMaxEntries: 0,
        bufferCommands: false,
      };

      const connection = await mongoose.createConnection(uri, connectionOptions);
      
      connection.on('connected', () => {
        logger.info(`MongoDB connected to ${databaseName}`);
      });

      connection.on('error', (err) => {
        logger.error(`MongoDB connection error for ${databaseName}:`, err);
      });

      connection.on('disconnected', () => {
        logger.warn(`MongoDB disconnected from ${databaseName}`);
      });

      this.connections[databaseName] = connection;
      return connection;
    } catch (error) {
      logger.error(`Failed to connect to MongoDB ${databaseName}:`, error);
      throw error;
    }
  }

  getConnection(databaseName) {
    return this.connections[databaseName];
  }

  async closeConnection(databaseName) {
    if (this.connections[databaseName]) {
      await this.connections[databaseName].close();
      delete this.connections[databaseName];
      logger.info(`Closed connection to ${databaseName}`);
    }
  }

  async closeAllConnections() {
    const closePromises = Object.keys(this.connections).map(dbName => 
      this.closeConnection(dbName)
    );
    await Promise.all(closePromises);
  }
}

module.exports = new DatabaseConnection();