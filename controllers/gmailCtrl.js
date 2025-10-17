const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  sendEmail,
  sendTestEmail,
  replyToEmail,
  forwardEmail
} = require('../services/nodemailerService');
const Admin = require('../models/Admin');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../temp/attachments');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename to avoid conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
    files: 10 // Maximum 10 files
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/html', 'text/csv',
      'application/zip', 'application/x-zip-compressed'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

const gmailCtrl = {
  // ✅ Send email with optional attachments
  sendEmail: async (req, res) => {
    try {
      console.log('=== SEND EMAIL WITH NODEMAILER ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { to, subject, text } = req.body;
      const adminId = req.user._id;
      const attachments = req.files || [];

      if (!to || !subject || !text) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: to, subject, text'
        });
      }

      console.log('Processing email with:', {
        adminId,
        to,
        subject,
        textLength: text.length,
        attachmentCount: attachments.length
      });

      const result = await sendEmail(adminId, to, subject, text, attachments);
      
      // Clean up uploaded files after sending
      attachments.forEach(file => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            console.log('Cleaned up file:', file.path);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up file:', file.path, cleanupError);
        }
      });

      res.json({ 
        success: true,
        message: 'Email sent successfully', 
        result 
      });
    } catch (err) {
      console.error('Error sending email:', err);
      
      // Clean up uploaded files on error
      if (req.files) {
        req.files.forEach(file => {
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (cleanupError) {
            console.error('Error cleaning up file on error:', file.path, cleanupError);
          }
        });
      }

      res.status(500).json({ 
        success: false,
        message: 'Send failed', 
        error: err.message 
      });
    }
  },

  // Note: Email listing, searching, and details functions removed as they require Gmail API
  // These would need to be implemented separately if needed

  // ✅ Reply to an email with optional attachments
  replyToEmail: async (req, res) => {
    try {
      console.log('=== REPLY EMAIL WITH NODEMAILER ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { originalMessageId, replyText } = req.body;
      const adminId = req.user._id;
      const attachments = req.files || [];
      
      if (!originalMessageId || !replyText) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: originalMessageId, replyText'
        });
      }

      console.log('Processing reply with:', {
        adminId,
        originalMessageId,
        replyTextLength: replyText.length,
        attachmentCount: attachments.length
      });

      const result = await replyToEmail(adminId, originalMessageId, replyText, attachments);
      
      // Clean up uploaded files after sending
      attachments.forEach(file => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            console.log('Cleaned up file:', file.path);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up file:', file.path, cleanupError);
        }
      });

      res.json({
        success: true,
        message: 'Reply sent successfully',
        data: result
      });
    } catch (error) {
      console.error('Error replying to email:', error);
      
      // Clean up uploaded files on error
      if (req.files) {
        req.files.forEach(file => {
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (cleanupError) {
            console.error('Error cleaning up file on error:', file.path, cleanupError);
          }
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Failed to reply to email',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // ✅ Forward email with optional attachments
  forwardEmail: async (req, res) => {
    try {
      console.log('=== FORWARD EMAIL WITH NODEMAILER ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { originalMessageId, forwardTo, forwardText } = req.body;
      const adminId = req.user._id;
      const attachments = req.files || [];
      
      if (!originalMessageId || !forwardTo || !forwardText) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: originalMessageId, forwardTo, forwardText'
        });
      }

      console.log('Processing forward with:', {
        adminId,
        originalMessageId,
        forwardTo,
        forwardTextLength: forwardText.length,
        attachmentCount: attachments.length
      });

      const result = await forwardEmail(adminId, originalMessageId, forwardTo, forwardText, attachments);
      
      // Clean up uploaded files after sending
      attachments.forEach(file => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            console.log('Cleaned up file:', file.path);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up file:', file.path, cleanupError);
        }
      });

      res.json({
        success: true,
        message: 'Email forwarded successfully',
        data: result
      });
    } catch (error) {
      console.error('Error forwarding email:', error);
      
      // Clean up uploaded files on error
      if (req.files) {
        req.files.forEach(file => {
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (cleanupError) {
            console.error('Error cleaning up file on error:', file.path, cleanupError);
          }
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Failed to forward email',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Note: Gmail-specific functions (markAsRead, moveToTrash, getAttachments) removed
  // These would need to be implemented separately if needed

  // Test email endpoint using nodemailer
  testEmail: async (req, res) => {
    const adminId = req.user._id;
    const { to } = req.body;
    
    try {
      console.log('Testing email delivery with nodemailer to:', to);
      
      if (!to) {
        return res.status(400).json({ 
          success: false,
          message: 'Recipient email address is required' 
        });
      }
      
      const result = await sendTestEmail(adminId, to);
      res.json({ 
        success: true,
        message: 'Test email sent successfully', 
        result,
        note: 'Check the recipient inbox and spam folder for the test email'
      });
    } catch (err) {
      console.error('Test email failed:', err);
      res.status(500).json({ 
        success: false,
        message: 'Test email failed', 
        error: err.message,
        details: {
          adminId,
          to,
          errorType: err.constructor.name
        }
      });
    }
  },

  // Note: Separate attachment functions removed as main functions now support attachments
};

module.exports = { gmailCtrl, upload };