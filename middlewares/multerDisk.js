const fs = require('fs');
const path = require('path');
const multer = require('multer');

const TEMP_ROOT = path.join(process.cwd(), 'uploads', 'tmp', 'task-photos');

if (!fs.existsSync(TEMP_ROOT)) {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });
}

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype.startsWith('video/') ||
    file.mimetype.startsWith('audio/') ||
    file.mimetype === 'application/pdf'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Not an image, video, audio, or PDF file!'), false);
  }
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!req._taskPhotoTempDir) {
      req._taskPhotoTempDir = path.join(
        TEMP_ROOT,
        `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
      );
      fs.mkdirSync(req._taskPhotoTempDir, { recursive: true });
    }
    cb(null, req._taskPhotoTempDir);
  },
  filename(req, file, cb) {
    const safe = (file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const uploadDisk = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
});

module.exports = uploadDisk;
module.exports.TEMP_ROOT = TEMP_ROOT;
