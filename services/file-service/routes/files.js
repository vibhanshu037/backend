const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../../../middleware/auth');
const database = require('../../../config/database');
const logger = require('../../../config/logger');
const fileSchema = require('../../../shared/models/File');

const router = express.Router();

// Get File model
const getFileModel = () => {
  const connection = database.getConnection('files');
  return connection.model('File', fileSchema);
};

// Get user's files
router.get('/my-files', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, fileType, meetingId } = req.query;
    const File = getFileModel();
    
    const query = {
      uploadedBy: req.user.userId,
      isDeleted: false
    };
    
    if (fileType) query.fileType = fileType;
    if (meetingId) query.meetingId = meetingId;

    const files = await File.find(query)
      .populate('uploadedBy', 'firstName lastName username')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await File.countDocuments(query);

    res.json({
      files: files.map(file => ({
        fileId: file.fileId,
        originalName: file.originalName,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        fileType: file.fileType,
        uploadedBy: file.uploadedBy,
        meetingId: file.meetingId,
        isPublic: file.isPublic,
        downloadCount: file.downloadCount,
        createdAt: file.createdAt,
        metadata: file.metadata
      })),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalFiles: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    logger.error('Get user files error:', error);
    res.status(500).json({
      error: 'Failed to get files'
    });
  }
});

// Get file details
router.get('/:fileId', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    const File = getFileModel();
    
    const file = await File.findOne({ fileId, isDeleted: false })
      .populate('uploadedBy', 'firstName lastName username')
      .populate('sharedWith.user', 'firstName lastName username');

    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Check permissions
    const hasAccess = (
      file.uploadedBy._id.toString() === req.user.userId ||
      file.isPublic ||
      file.sharedWith.some(share => share.user._id.toString() === req.user.userId)
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }

    res.json({
      file: {
        fileId: file.fileId,
        originalName: file.originalName,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        fileType: file.fileType,
        uploadedBy: file.uploadedBy,
        meetingId: file.meetingId,
        isPublic: file.isPublic,
        sharedWith: file.sharedWith,
        downloadCount: file.downloadCount,
        lastDownloaded: file.lastDownloaded,
        tags: file.tags,
        description: file.description,
        metadata: file.metadata,
        createdAt: file.createdAt
      }
    });

  } catch (error) {
    logger.error('Get file details error:', error);
    res.status(500).json({
      error: 'Failed to get file details'
    });
  }
});

// Share file with users
router.post('/:fileId/share', authMiddleware, [
  body('userIds').isArray({ min: 1 }),
  body('permissions.view').optional().isBoolean(),
  body('permissions.download').optional().isBoolean(),
  body('permissions.edit').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { fileId } = req.params;
    const { userIds, permissions = {} } = req.body;
    const File = getFileModel();
    
    const file = await File.findOne({ fileId, isDeleted: false });

    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Check if user owns the file
    if (file.uploadedBy.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'You can only share your own files'
      });
    }

    // Add users to shared list
    const defaultPermissions = {
      view: true,
      download: true,
      edit: false,
      ...permissions
    };

    for (const userId of userIds) {
      const existingShare = file.sharedWith.find(
        share => share.user.toString() === userId
      );

      if (!existingShare) {
        file.sharedWith.push({
          user: userId,
          permissions: defaultPermissions
        });
      } else {
        existingShare.permissions = defaultPermissions;
      }
    }

    await file.save();

    logger.info(`File ${fileId} shared with ${userIds.length} users by ${req.user.userId}`);

    res.json({
      message: 'File shared successfully',
      sharedWith: file.sharedWith.length
    });

  } catch (error) {
    logger.error('Share file error:', error);
    res.status(500).json({
      error: 'Failed to share file'
    });
  }
});

// Update file details
router.put('/:fileId', authMiddleware, [
  body('description').optional().isLength({ max: 500 }),
  body('tags').optional().isArray(),
  body('isPublic').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { fileId } = req.params;
    const { description, tags, isPublic } = req.body;
    const File = getFileModel();
    
    const file = await File.findOne({ fileId, isDeleted: false });

    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Check if user owns the file
    if (file.uploadedBy.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'You can only update your own files'
      });
    }

    // Update file details
    if (description !== undefined) file.description = description;
    if (tags !== undefined) file.tags = tags;
    if (isPublic !== undefined) file.isPublic = isPublic;

    await file.save();

    logger.info(`File ${fileId} updated by ${req.user.userId}`);

    res.json({
      message: 'File updated successfully',
      file: {
        fileId: file.fileId,
        description: file.description,
        tags: file.tags,
        isPublic: file.isPublic,
        updatedAt: file.updatedAt
      }
    });

  } catch (error) {
    logger.error('Update file error:', error);
    res.status(500).json({
      error: 'Failed to update file'
    });
  }
});

// Delete file
router.delete('/:fileId', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    const File = getFileModel();
    
    const file = await File.findOne({ fileId, isDeleted: false });

    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Check if user owns the file
    if (file.uploadedBy.toString() !== req.user.userId) {
      return res.status(403).json({
        error: 'You can only delete your own files'
      });
    }

    // Soft delete
    file.isDeleted = true;
    file.deletedAt = new Date();
    await file.save();

    logger.info(`File ${fileId} deleted by ${req.user.userId}`);

    res.json({
      message: 'File deleted successfully'
    });

  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({
      error: 'Failed to delete file'
    });
  }
});

// Download file
router.get('/:fileId/download', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    const File = getFileModel();
    
    const file = await File.findOne({ fileId, isDeleted: false });

    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Check permissions
    const hasDownloadAccess = (
      file.uploadedBy.toString() === req.user.userId ||
      file.isPublic ||
      file.sharedWith.some(share => 
        share.user.toString() === req.user.userId && share.permissions.download
      )
    );

    if (!hasDownloadAccess) {
      return res.status(403).json({
        error: 'Download access denied'
      });
    }

    // Update download stats
    file.downloadCount++;
    file.lastDownloaded = new Date();
    await file.save();

    // In a real implementation, this would serve the actual file
    // For now, return file info for download
    res.json({
      message: 'File download initiated',
      downloadUrl: `/files/serve/${file.fileName}`,
      file: {
        fileId: file.fileId,
        originalName: file.originalName,
        fileSize: file.fileSize,
        mimeType: file.mimeType
      }
    });

    logger.info(`File ${fileId} downloaded by ${req.user.userId}`);

  } catch (error) {
    logger.error('Download file error:', error);
    res.status(500).json({
      error: 'Failed to download file'
    });
  }
});

// Get files shared with user
router.get('/shared/with-me', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const File = getFileModel();
    
    const files = await File.find({
      'sharedWith.user': req.user.userId,
      isDeleted: false
    })
      .populate('uploadedBy', 'firstName lastName username')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await File.countDocuments({
      'sharedWith.user': req.user.userId,
      isDeleted: false
    });

    res.json({
      files: files.map(file => {
        const sharedPermissions = file.sharedWith.find(
          share => share.user.toString() === req.user.userId
        )?.permissions;

        return {
          fileId: file.fileId,
          originalName: file.originalName,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          fileType: file.fileType,
          uploadedBy: file.uploadedBy,
          permissions: sharedPermissions,
          createdAt: file.createdAt
        };
      }),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalFiles: total
      }
    });

  } catch (error) {
    logger.error('Get shared files error:', error);
    res.status(500).json({
      error: 'Failed to get shared files'
    });
  }
});

module.exports = router;