/** MIME subtype → extension Cloudinary accepts (vendor trees like audio/x-m4a break uploads otherwise). */
function cloudinaryFormatFromMimetype(mimetype) {
  if (!mimetype || typeof mimetype !== 'string') return 'jpg';
  const subtype = mimetype.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (!subtype) return 'jpg';
  let ext = subtype.startsWith('x-') ? subtype.slice(2) : subtype;
  const aliases = {
    m4a: 'mp4',
    mpeg: 'mp3',
    mpga: 'mp3',
    quicktime: 'mov',
    '3gpp': '3gp',
    '3gpp2': '3g2',
  };
  return aliases[ext] || ext;
}

/**
 * Build Cloudinary upload options aligned with multer CloudinaryStorage settings.
 * @param {{ mimetype?: string, originalname?: string }} file
 */
function buildCloudinaryUploadOptions(file) {
  const mimetype = file.mimetype || '';
  const isVideo = mimetype.startsWith('video/') || mimetype.startsWith('audio/');
  const isImage = mimetype.startsWith('image/');
  const isPdf = mimetype === 'application/pdf';
  const baseName = (file.originalname || 'file').replace(/\.[^/.]+$/, '');
  const publicId = `${Date.now()}-${Math.random().toString(36).substring(7)}-${baseName}`;

  if (isPdf) {
    return {
      folder: 'uploads',
      resource_type: 'raw',
      public_id: publicId,
      overwrite: true,
    };
  }

  const baseParams = {
    folder: 'uploads',
    format: isVideo ? cloudinaryFormatFromMimetype(mimetype) : 'jpg',
    resource_type: isVideo ? 'video' : 'image',
    public_id: publicId,
    quality: 'auto:good',
    overwrite: true,
  };

  if (isImage) {
    baseParams.transformation = [
      {
        quality: 'auto:good',
        fetch_format: 'auto',
        flags: 'progressive',
      },
    ];
  }

  if (isVideo) {
    baseParams.eager_async = true;
    baseParams.eager = [
      {
        format: 'mp4',
        video_codec: 'h264',
        quality: 'auto:good',
      },
    ];
  }

  return baseParams;
}

module.exports = {
  cloudinaryFormatFromMimetype,
  buildCloudinaryUploadOptions,
};
