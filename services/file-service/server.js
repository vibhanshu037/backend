const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const cors = require('cors');
const helmet = require('helmet');
const config = require('../../config/config');
const logger = require('../../config/logger');
const database = require('../../config/database');
const redisClient = require('../../config/redis');
const fileRoutes = require('./routes/files');

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

// Create upload directories
const createUploadDirs = async () => {
  const dirs = [
    config.fileUpload.uploadPath,
    config.fileUpload.recordingPath,
    path.join(config.fileUpload.uploadPath, 'images'),
    path.join(config.fileUpload.uploadPath, 'documents'),
    path.join(config.fileUpload.uploadPath, 'avatars'),
    path.join(config.fileUpload.uploadPath, 'thumbnails')
  ];

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create directory ${dir}:`, error);
    }
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = config.fileUpload.uploadPath;
    
    if (file.mimetype.startsWith('image/')) {
      uploadPath = path.join(config.fileUpload.uploadPath, 'images');
    } else {
      uploadPath = path.join(config.fileUpload.uploadPath, 'documents');
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = config.fileUpload.allowedTypes;
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.fileUpload.maxFileSize,
    files: 10 // Max 10 files at once
  }
});

// File upload endpoint
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded'
      });
    }

    const uploadedFiles = [];

    for (const file of req.files) {
      const fileInfo = {
        fileId: require('uuid').v4(),
        originalName: file.originalname,
        fileName: file.filename,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileType: getFileType(file.mimetype),
        uploadedAt: new Date()
      };

      // Generate thumbnail for images
      if (file.mimetype.startsWith('image/')) {
        try {
          const thumbnailPath = path.join(
            config.fileUpload.uploadPath, 
            'thumbnails', 
            `thumb-${file.filename}`
          );
          
          await sharp(file.path)
            .resize(200, 200, { 
              fit: 'inside',
              withoutEnlargement: true 
            })
            .jpeg({ quality: 80 })
            .toFile(thumbnailPath);
          
          fileInfo.thumbnail = thumbnailPath;
        } catch (error) {
          logger.error('Failed to generate thumbnail:', error);
        }
      }

      uploadedFiles.push(fileInfo);
    }

    res.json({
      message: 'Files uploaded successfully',
      files: uploadedFiles
    });

    logger.info(`${req.files.length} files uploaded`);

  } catch (error) {
    logger.error('File upload error:', error);
    res.status(500).json({
      error: 'Failed to upload files'
    });
  }
});

// Avatar upload endpoint
app.post('/api/upload/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No avatar file uploaded'
      });
    }

    const file = req.file;
    
    // Validate image type
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({
        error: 'Avatar must be an image file'
      });
    }

    const avatarPath = path.join(
      config.fileUpload.uploadPath,
      'avatars',
      `avatar-${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`
    );

    // Resize and optimize avatar
    await sharp(file.path)
      .resize(200, 200, { 
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 85 })
      .toFile(avatarPath);

    // Delete original file
    await fs.unlink(file.path);

    const avatarInfo = {
      fileId: require('uuid').v4(),
      originalName: file.originalname,
      fileName: path.basename(avatarPath),
      filePath: avatarPath,
      fileSize: (await fs.stat(avatarPath)).size,
      mimeType: 'image/jpeg',
      fileType: 'image',
      uploadedAt: new Date()
    };

    res.json({
      message: 'Avatar uploaded successfully',
      avatar: avatarInfo
    });

    logger.info('Avatar uploaded and processed');

  } catch (error) {
    logger.error('Avatar upload error:', error);
    res.status(500).json({
      error: 'Failed to upload avatar'
    });
  }
});

// Serve files
app.get('/api/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Get file info from database or cache
    // This would use the File model to get file details
    
    // For now, serve files directly (in production, use a CDN or proper file serving)
    res.sendFile(path.resolve(filePath));

  } catch (error) {
    logger.error('Serve file error:', error);
    res.status(404).json({
      error: 'File not found'
    });
  }
});

// Routes
app.use('/api', fileRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'File Service',
    timestamp: new Date().toISOString()
  });
});

// Helper function to determine file type
function getFileType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return 'document';
  return 'other';
}

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: `Maximum file size is ${config.fileUpload.maxFileSize / (1024 * 1024)}MB`
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: 'Maximum 10 files allowed at once'
      });
    }
  }

  logger.error('File Service error:', error);
  res.status(error.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

const PORT = config.ports.fileService;

const startServer = async () => {
  try {
    // Create upload directories
    await createUploadDirs();
    
    // Connect to databases
    await database.connect('files', config.databases.files);
    await redisClient.connect();
    
    const server = app.listen(PORT, () => {
      logger.info(`File Service running on http://localhost:${PORT}`);
      logger.info(`Upload directory: ${config.fileUpload.uploadPath}`);
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down File Service...');
      server.close(async () => {
        await database.closeAllConnections();
        await redisClient.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start File Service:', error);
    process.exit(1);
  }
};

startServer();