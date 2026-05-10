const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../helper/cloudinaryConfig');

/** MIME subtype → extension Cloudinary accepts (vendor trees like audio/x-m4a break uploads otherwise). */
function cloudinaryFormatFromMimetype(mimetype) {
  if (!mimetype || typeof mimetype !== 'string') return 'jpg';
  const subtype = mimetype.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (!subtype) return 'jpg';
  let ext = subtype.startsWith('x-') ? subtype.slice(2) : subtype;
  const aliases = {
    m4a: 'mp4', // AAC in MPEG-4 container; Cloudinary lists mp4, not m4a, for video uploads
    mpeg: 'mp3',
    mpga: 'mp3',
    quicktime: 'mov',
    '3gpp': '3gp',
    '3gpp2': '3g2',
  };
  return aliases[ext] || ext;
}

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/');
    const isImage = file.mimetype.startsWith('image/');
    const isPdf = file.mimetype === 'application/pdf';
    
    // Handle PDF files as raw files
    if (isPdf) {
      return {
        folder: 'uploads',
        resource_type: 'raw',
        public_id: `${Date.now()}-${Math.random().toString(36).substring(7)}-${file.originalname.replace(/\.[^/.]+$/, '')}`,
        overwrite: true,
      };
    }
    
    const baseParams = {
      folder: 'uploads',
      format: isVideo ? cloudinaryFormatFromMimetype(file.mimetype) : 'jpg',
      resource_type: isVideo ? 'video' : 'image',
      public_id: `${Date.now()}-${Math.random().toString(36).substring(7)}-${file.originalname.replace(/\.[^/.]+$/, '')}`,
      
      // ⚡ PERFORMANCE OPTIMIZATIONS:
      
      // 1. Auto quality optimization (30-50% smaller files, faster upload, maintains good quality)
      quality: 'auto:good',
      
      // 2. Overwrite existing files (skips existence checks - saves ~100-200ms per file)
      overwrite: true,
    };

    // Image-specific optimizations
    if (isImage) {
      // Add progressive JPEG flag for better perceived performance
      // Progressive loading: shows low-res image first, then improves quality
      baseParams.transformation = [
        {
          quality: 'auto:good',
          fetch_format: 'auto', // WebP/AVIF when supported, JPEG fallback
          flags: 'progressive', // Progressive JPEG loading for better UX
        }
      ];
    }

    // Video-specific optimizations
    if (isVideo) {
      // Process video transformations asynchronously (non-blocking)
      baseParams.eager_async = true;
      // Generate optimized MP4 format during upload for faster delivery
      baseParams.eager = [
        { 
          format: 'mp4', 
          video_codec: 'h264',
          quality: 'auto:good',
        }
      ];
    }

    return baseParams;
  },
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
