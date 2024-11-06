const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../helper/cloudinaryConfig');

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uploads',
    format: async (req, file) => {
      if (file.mimetype.startsWith('video')) {
        return file.mimetype.split('/')[1]; // Keeps the original video format
      } else {
        return 'jpg'; // Converts images to jpg
      }
    },
    resource_type: async (req, file) => {
      if (file.mimetype.startsWith('video')) {
        return 'video';
      } else {
        return 'image';
      }
    },
    public_id: (req, file) => `${Date.now()}-${file.originalname}`,
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image or video file!'), false);
  }
};

const parser = multer({ storage: storage, fileFilter: fileFilter });

module.exports = parser;
