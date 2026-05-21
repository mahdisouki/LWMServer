const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../helper/cloudinaryConfig');
const { buildCloudinaryUploadOptions } = require('../helper/cloudinaryUploadParams');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => buildCloudinaryUploadOptions(file),
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Not an image, video, audio, or PDF file!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
    // Note: File count limit should be specified in multer.array('fieldname', maxCount)
    // Example: multer.array('uploads', 50) allows up to 50 files
  }
});

module.exports = upload;
