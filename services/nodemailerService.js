const nodemailer = require('nodemailer');
const Admin = require('../models/Admin');
const fs = require('fs');
const path = require('path');

// Create a reusable transporter object using SMTP transport
const createTransporter = async (adminId) => {
  try {
    const admin = await Admin.findById(adminId);
    if (!admin) {
      throw new Error('Admin not found');
    }

    // You can configure this based on your email provider
    // For Gmail, you would use the admin's Gmail credentials
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or your preferred email service
      auth: {
        user: process.env.EMAIL_USER, // Admin's email
        pass: process.env.EMAIL_PASSWORD // Admin's app password or environment variable
      }
    });

    // Verify connection configuration
    await transporter.verify();
    console.log('SMTP connection verified successfully');
    
    return transporter;
  } catch (error) {
    console.error('Error creating email transporter:', error);
    throw new Error(`Failed to create email transporter: ${error.message}`);
  }
};

// Send email with attachments using nodemailer
async function sendEmail(adminId, to, subject, text, attachments = []) {
  try {
    console.log('Sending email with nodemailer:', {
      adminId,
      to,
      subject,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

    const transporter = await createTransporter(adminId);
    const admin = await Admin.findById(adminId);

    if (!admin) {
      throw new Error('Admin not found');
    }

    // Prepare email content with signature
    const htmlContent = `${text}<br><br>${admin.emailSignature || ''}`;

    // Prepare attachments for nodemailer
    const nodemailerAttachments = attachments.map(file => {
      return {
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype
      };
    });

    // Email options
    const mailOptions = {
      from: admin.email, // Sender email
      to: to, // Recipient email
      subject: subject,
      html: htmlContent,
      attachments: nodemailerAttachments
    };

    console.log('Sending email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      attachmentCount: mailOptions.attachments.length
    });

    // Send email
    const result = await transporter.sendMail(mailOptions);
    
    console.log('Email sent successfully:', {
      messageId: result.messageId,
      response: result.response
    });

    return {
      messageId: result.messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected
    };

  } catch (error) {
    console.error('Error in sendEmail:', {
      error: error.message,
      stack: error.stack,
      adminId,
      to,
      subject,
      attachmentCount: attachments.length
    });
    throw error;
  }
}

// Send test email
async function sendTestEmail(adminId, to) {
  try {
    console.log('=== SENDING TEST EMAIL WITH NODEMAILER ===');
    const testSubject = `Test Email - ${new Date().toISOString()}`;
    const testText = `
      <h2>Test Email from London Waste Management</h2>
      <p>This is a test email to verify email delivery functionality using Nodemailer.</p>
      <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
      <p><strong>Admin ID:</strong> ${adminId}</p>
      <p>If you receive this email, the Nodemailer integration is working correctly.</p>
    `;

    const result = await sendEmail(adminId, to, testSubject, testText);
    console.log('Test email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Test email failed:', error);
    throw error;
  }
}

// Reply to email with attachments
async function replyToEmail(adminId, originalMessageId, replyText, attachments = []) {
  try {
    console.log('=== REPLY EMAIL WITH NODEMAILER ===');
    console.log('Input parameters:', { 
      adminId, 
      originalMessageId, 
      replyTextLength: replyText?.length, 
      attachmentCount: attachments.length 
    });

    const transporter = await createTransporter(adminId);
    const admin = await Admin.findById(adminId);

    if (!admin) {
      throw new Error('Admin not found');
    }

    // For nodemailer, we'll use a simple reply format
    // In a real implementation, you might want to fetch the original email details
    const replySubject = `Re: Email Reply - ${new Date().toISOString()}`;
    const htmlContent = `${replyText}<br><br>${admin.emailSignature || ''}`;

    // Prepare attachments for nodemailer
    const nodemailerAttachments = attachments.map(file => {
      return {
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype
      };
    });

    // Email options for reply
    const mailOptions = {
      from: admin.email,
      to: 'recipient@example.com', // You might want to extract this from the original message
      subject: replySubject,
      html: htmlContent,
      attachments: nodemailerAttachments,
      inReplyTo: originalMessageId, // Reference to original message
      references: originalMessageId
    };

    console.log('Sending reply email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      attachmentCount: mailOptions.attachments.length
    });

    const result = await transporter.sendMail(mailOptions);
    
    console.log('Reply email sent successfully:', {
      messageId: result.messageId,
      response: result.response
    });

    return {
      messageId: result.messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected
    };

  } catch (error) {
    console.error('Error in replyToEmail:', {
      error: error.message,
      stack: error.stack,
      adminId,
      originalMessageId,
      attachmentCount: attachments.length
    });
    throw error;
  }
}

// Forward email with attachments
async function forwardEmail(adminId, originalMessageId, forwardTo, forwardText, attachments = []) {
  try {
    console.log('=== FORWARD EMAIL WITH NODEMAILER ===');
    console.log('Input parameters:', { 
      adminId, 
      originalMessageId, 
      forwardTo, 
      forwardTextLength: forwardText?.length,
      attachmentCount: attachments.length 
    });

    const transporter = await createTransporter(adminId);
    const admin = await Admin.findById(adminId);

    if (!admin) {
      throw new Error('Admin not found');
    }

    const forwardSubject = `Fwd: Email Forward - ${new Date().toISOString()}`;
    const htmlContent = `${forwardText}<br><br>${admin.emailSignature || ''}`;

    // Prepare attachments for nodemailer
    const nodemailerAttachments = attachments.map(file => {
      return {
        filename: file.originalname,
        path: file.path,
        contentType: file.mimetype
      };
    });

    // Email options for forward
    const mailOptions = {
      from: admin.email,
      to: forwardTo,
      subject: forwardSubject,
      html: htmlContent,
      attachments: nodemailerAttachments
    };

    console.log('Sending forward email with options:', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      attachmentCount: mailOptions.attachments.length
    });

    const result = await transporter.sendMail(mailOptions);
    
    console.log('Forward email sent successfully:', {
      messageId: result.messageId,
      response: result.response
    });

    return {
      messageId: result.messageId,
      response: result.response,
      accepted: result.accepted,
      rejected: result.rejected
    };

  } catch (error) {
    console.error('Error in forwardEmail:', {
      error: error.message,
      stack: error.stack,
      adminId,
      originalMessageId,
      forwardTo,
      attachmentCount: attachments.length
    });
    throw error;
  }
}

module.exports = {
  sendEmail,
  sendTestEmail,
  replyToEmail,
  forwardEmail,
  createTransporter
};
