const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  
  // Performance optimizations
  secure: true, // Use HTTPS
  cdn_subdomain: true, // Enable CDN subdomain for faster delivery
  secure_cdn_subdomain: true,
  
  // API timeout settings
  timeout: 60000, // 60 seconds
});

module.exports = cloudinary;
