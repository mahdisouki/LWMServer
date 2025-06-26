const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  sendEmail,
  fetchEmails,
  searchEmails,
  getEmailById,
  replyToEmail,
  forwardEmail,
  markAsRead,
  moveToTrash,
  getAttachment,
  sendTestEmail,
  getGmailAuth,
  findMessageIdByHeaderId
} = require('../services/gmailService');
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
  // ✅ Send email
  sendEmail: async (req, res) => {
    const { to, subject, text } = req.body;
    const adminId = req.user._id;
    try {
      const result = await sendEmail(adminId, to, subject, text);
      res.json({ message: 'Email sent', result });
    } catch (err) {
      res.status(500).json({ message: 'Send failed', error: err.message });
    }
  },

  // ✅ List emails by label (INBOX, SPAM, SENT, etc.)
  listEmails: async (req, res) => {
    const adminId = req.user._id;
    const label = req.query.label || 'INBOX';
    try {
      const emails = await fetchEmails(adminId, label);
      res.json({ emails });
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch emails', error: err.message });
    }
  },

  // ✅ Search emails using Gmail query syntax
  searchEmails: async (req, res) => {
    const adminId = req.user._id;
    const query = req.query.q || '';
    try {
      const emails = await searchEmails(adminId, query);
      res.json({ emails });
    } catch (err) {
      res.status(500).json({ message: 'Search failed', error: err.message });
    }
  },

  // ✅ Get full email details by ID
  listEmailDetails: async (req, res) => {
    const adminId = req.user._id;
    const { emailId } = req.params;
    try {
      const email = await getEmailById(adminId, emailId);
      res.json({ email });
    } catch (err) {
      res.status(500).json({ message: 'Failed to get email', error: err.message });
    }
  },

  // ✅ Reply to an email
  replyToEmail: async (req, res) => {
    const adminId = req.user._id;
    console.log('=== CONTROLLER REPLY START ===');
    console.log('Controller - Request body:', req.body);
    console.log('Controller - Request params:', req.params);
    console.log('Controller - Admin ID:', adminId);
    
    const { emailId } = req.params;
    const { text } = req.body;
    
    try {
      console.log('Controller - Starting reply with:', { adminId, emailId, textLength: text?.length });
      
      if (!emailId) {
        console.log('Controller - Missing emailId');
        return res.status(400).json({ message: 'Email ID is required' });
      }
      
      if (!text) {
        console.log('Controller - Missing text');
        return res.status(400).json({ message: 'Reply text is required' });
      }
      
      console.log('Controller - Calling replyToEmail service...');
      const result = await replyToEmail(adminId, emailId, text);
      console.log('Controller - Reply successful:', result);
      console.log('=== CONTROLLER REPLY SUCCESS ===');
      res.json({ message: 'Reply sent', result });
    } catch (err) {
      console.error('=== CONTROLLER REPLY ERROR ===');
      console.error('Controller - Reply failed:', {
        error: err.message,
        stack: err.stack,
        adminId,
        emailId,
        textLength: text?.length
      });
      
      // Check if it's a self-reply error
      if (err.message.includes('Cannot reply to your own email')) {
        console.log('Controller - Self-reply error detected');
        return res.status(400).json({ 
          message: 'Cannot reply to your own email. Please use the "Send Email" function instead.',
          error: err.message,
          suggestion: 'Use the send email endpoint to compose a new email'
        });
      }
      
      // Check for Gmail API specific errors
      if (err.response) {
        console.error('Controller - Gmail API Error:', {
          status: err.response.status,
          statusText: err.response.statusText,
          data: err.response.data
        });
      }
      
      console.error('=== CONTROLLER REPLY ERROR END ===');
      res.status(500).json({ 
        message: 'Reply failed', 
        error: err.message,
        details: {
          adminId,
          emailId,
          errorType: err.constructor.name,
          gmailError: err.response?.data || null
        }
      });
    }
  },

  // ✅ Forward email
  forwardEmail: async (req, res) => {
    const adminId = req.user._id;
    const { emailId } = req.params;
    const { to, note } = req.body; // 'note' = extra content before forwarded email

    console.log('=== CONTROLLER FORWARD START ===');
    console.log('Controller - Request params:', req.params);
    console.log('Controller - Request body:', req.body);
    console.log('Controller - Admin ID:', adminId);

    if (!to) {
      console.log('Controller - Missing "to" email address');
      return res.status(400).json({ message: "Missing 'to' email address" });
    }

    try {
      console.log('Controller - Starting forward with:', { adminId, emailId, to, noteLength: note?.length });
      
      // Decode URL-encoded email ID if needed
      let decodedEmailId = emailId;
      if (emailId.includes('%3C') || emailId.includes('%3E')) {
        decodedEmailId = decodeURIComponent(emailId);
        console.log('Controller - Decoded email ID:', { original: emailId, decoded: decodedEmailId });
      }
      
      console.log('Controller - Calling forwardEmail service...');
      const result = await forwardEmail(adminId, decodedEmailId, to, note);
      console.log('Controller - Forward successful:', result);
      console.log('=== CONTROLLER FORWARD SUCCESS ===');
      res.json({ message: 'Email forwarded', result });
    } catch (err) {
      console.error('=== CONTROLLER FORWARD ERROR ===');
      console.error('Controller - Forward failed:', {
        error: err.message,
        stack: err.stack,
        adminId,
        emailId,
        decodedEmailId: emailId.includes('%3C') ? decodeURIComponent(emailId) : emailId,
        to
      });
      
      // Check for Gmail API specific errors
      if (err.response) {
        console.error('Controller - Gmail API Error:', {
          status: err.response.status,
          statusText: err.response.statusText,
          data: err.response.data
        });
      }
      
      console.error('=== CONTROLLER FORWARD ERROR END ===');
      res.status(500).json({ 
        message: 'Forward failed', 
        error: err.message,
        details: {
          adminId,
          emailId,
          errorType: err.constructor.name,
          gmailError: err.response?.data || null
        }
      });
    }
  },

  // ✅ Mark email as read
  markAsRead: async (req, res) => {
    const adminId = req.user._id;
    const { emailId } = req.params;

    try {
      await markAsRead(adminId, emailId);
      res.json({ message: 'Marked as read' });
    } catch (err) {
      res.status(500).json({ message: 'Failed to mark as read', error: err.message });
    }
  },

  moveToTrash: async (req, res) => {
    const { adminId, messageId } = req.body;
    try {
      await moveToTrash(adminId, messageId);
      res.status(200).json({ message: 'Email moved to trash successfully.' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to move email to trash', error: error.message });
    }
  },

  getAttachments: async (req, res) => {
    const { adminId, messageId } = req.query;
    try {
      const attachments = await getAttachment(adminId, messageId);
      res.status(200).json({ attachments });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch attachments', error: error.message });
    }
  },

  // Test email endpoint
  testEmail: async (req, res) => {
    const adminId = req.user._id;
    const { to } = req.body;
    
    try {
      console.log('Testing email delivery to:', to);
      
      if (!to) {
        return res.status(400).json({ message: 'Recipient email address is required' });
      }
      
      const result = await sendTestEmail(adminId, to);
      res.json({ 
        message: 'Test email sent successfully', 
        result,
        note: 'Check the recipient inbox and spam folder for the test email'
      });
    } catch (err) {
      console.error('Test email failed:', err);
      res.status(500).json({ 
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

  // Send email with attachments
  sendEmailWithAttachments: async (req, res) => {
    try {
      console.log('=== SEND EMAIL WITH ATTACHMENTS ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { adminId, to, subject, text } = req.body;
      
      if (!adminId || !to || !subject || !text) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: adminId, to, subject, text'
        });
      }

      const attachments = req.files || [];
      console.log('Processing attachments:', attachments.length);

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
        data: result
      });
    } catch (error) {
      console.error('Error sending email with attachments:', error);
      
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
        message: error.message || 'Failed to send email',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  // Reply to email with attachments
  replyToEmailWithAttachments: async (req, res) => {
    try {
      console.log('=== REPLY EMAIL WITH ATTACHMENTS ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { adminId, messageId, replyText } = req.body;
      
      if (!adminId || !messageId || !replyText) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: adminId, messageId, replyText'
        });
      }

      const attachments = req.files || [];
      console.log('Processing attachments for reply:', attachments.length);

      const result = await replyToEmail(adminId, messageId, replyText, attachments);
      
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
      console.error('Error replying to email with attachments:', error);
      
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

  // Forward email with attachments
  forwardEmailWithAttachments: async (req, res) => {
    try {
      console.log('=== FORWARD EMAIL WITH ATTACHMENTS ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { adminId, messageId, forwardTo, forwardText } = req.body;
      
      if (!adminId || !messageId || !forwardTo || !forwardText) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: adminId, messageId, forwardTo, forwardText'
        });
      }

      const attachments = req.files || [];
      console.log('Processing attachments for forward:', attachments.length);

      const result = await forwardEmail(adminId, messageId, forwardTo, forwardText, attachments);
      
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
      console.error('Error forwarding email with attachments:', error);
      
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
  }
};

module.exports = { gmailCtrl, upload };