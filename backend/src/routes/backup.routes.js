const express = require('express');
const router = express.Router();
const backupUpload = require('../middleware/backupUpload');
const { uploadLimit, MAX_RECORD_BYTES } = require('../services/backupFile.service');
const backupController = require('../controllers/backup.controller');
const { authenticate, requireAdmin } = require('../middleware/auth');


/**
 * Backup Routes (Admin Only)
 * All endpoints require admin authentication
 *
 * NOTE: Specific routes (settings, cleanup, restore) must come before parameterized routes (:id)
 * to avoid route conflicts
 */

// Lightweight failure banner status (admin only).
router.get('/failure-status', authenticate, requireAdmin, backupController.getFailureStatus);

// Get backup settings (must come before /:id routes)
router.get('/settings', authenticate, requireAdmin, backupController.getSettings);

// Update backup settings
router.put('/settings', authenticate, requireAdmin, backupController.updateSettings);

// Cleanup old backups
router.post('/cleanup', authenticate, requireAdmin, backupController.cleanupOldBackups);

// Restore from backup file
router.get('/restore-limits', authenticate, requireAdmin, (req, res) => res.json({ maxUploadBytes: uploadLimit(), maxRecordBytes: MAX_RECORD_BYTES }));
router.post('/restore', authenticate, requireAdmin, backupUpload);

// Create a manual backup
router.post('/', authenticate, requireAdmin, backupController.createBackup);

// Get all backups
router.get('/', authenticate, requireAdmin, backupController.getBackups);

// Download a backup file
router.get('/:id/download', authenticate, requireAdmin, backupController.downloadBackup);

// Delete a backup
router.delete('/:id', authenticate, requireAdmin, backupController.deleteBackup);

module.exports = router;
