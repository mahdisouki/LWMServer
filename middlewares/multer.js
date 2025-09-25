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
      } else if (file.mimetype.startsWith('audio')) {
        return file.mimetype.split('/')[1]; // Keeps the original audio format
      } else {
        return 'jpg'; // Converts images to jpg
      }
    },
    resource_type: async (req, file) => {
      if (file.mimetype.startsWith('video')) {
        return 'video';
      } else if (file.mimetype.startsWith('audio')) {
        return 'video'; // Cloudinary uses 'video' resource type for audio files
      } else {
        return 'image';
      }
    },
    public_id: (req, file) => `${Date.now()}-${file.originalname}`,
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image, video or audio file!'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

module.exports = upload;
