const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const multer = require('multer');
const { uploadLimit } = require('../services/backupFile.service');

let restoring = false;
module.exports = async function backupUpload(req, res, next) {
  if (restoring) return res.status(409).json({ error: 'Another restore is in progress. Wait for it to finish.' });
  restoring = true;
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tradetally-restore-'));
    await fs.chmod(directory, 0o700);
    req.backupUploadDirectory = directory;
    req.setTimeout(900000);
    res.setTimeout(900000);
    const upload = multer({
      dest: directory,
      limits: { fileSize: uploadLimit(), files: 1, fields: 3, parts: 4, fieldSize: 1024 },
      fileFilter: (request, file, cb) => cb(null, file.originalname.toLowerCase().endsWith('.json'))
    }).single('file');
    await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    // Await the controller before deleting the private staging directory.
    await require('../controllers/backup.controller').restoreBackup(req, res, next);
  } catch (error) {
    if (!res.headersSent) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? `Backup exceeds the ${Math.floor(uploadLimit() / 1048576)} MiB upload limit.` : 'Could not accept backup upload. Select a JSON backup file and try again.'
      });
    }
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {
      console.warn('[RESTORE] Temporary upload cleanup failed. Restart the app container to discard temporary restore files.');
    });
    restoring = false;
  }
};
