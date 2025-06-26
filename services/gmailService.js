const { google } = require('googleapis');
const { getGmailAuth } = require('./gmailAuthHelper');
const Admin = require('../models/Admin');
const fs = require('fs');
const path = require('path');
function encodeMessage(raw) {
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

async function sendEmail(adminId, to, subject, text, attachments = []) {
  try {
    const gmail = await getGmailAuth(adminId);
    const admin = await Admin.findById(adminId);

    console.log('Sending email with:', {
      adminId,
      to,
      subject,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
      hasSignature: !!admin.emailSignature
    });

    // Get authenticated user email
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticatedEmail = profile.data.emailAddress;

    // Generate a unique Message-ID
    const messageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${authenticatedEmail.split('@')[1]}>`;

    const boundary = 'boundary_xyz';
    let messageParts = [];

    messageParts.push(`--${boundary}`);
    messageParts.push('Content-Type: text/html; charset="UTF-8"');
    messageParts.push('');
    messageParts.push(`${text}<br><br>${admin.emailSignature || ''}`);

    // Handle attachments
    for (const file of attachments) {
      try {
        console.log('Processing attachment:', {
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });

        const content = fs.readFileSync(file.path).toString('base64');
        messageParts.push(`--${boundary}`);
        messageParts.push(`Content-Type: ${file.mimetype}`);
        messageParts.push('Content-Transfer-Encoding: base64');
        messageParts.push(`Content-Disposition: attachment; filename="${file.originalname}"`);
        messageParts.push('');
        messageParts.push(content);
        
        console.log('Attachment processed successfully:', file.originalname);
      } catch (attachmentError) {
        console.error('Error processing attachment:', file.originalname, attachmentError);
        throw new Error(`Failed to process attachment ${file.originalname}: ${attachmentError.message}`);
      }
    }

    messageParts.push(`--${boundary}--`);

    const rawMessage = [
      `From: ${authenticatedEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      `Date: ${new Date().toUTCString()}`,
      `User-Agent: London Waste Management Gmail Integration`,
      `X-Mailer: London Waste Management System`,
      '',
      messageParts.join('\r\n')
    ].join('\r\n');

    console.log('Sending email via Gmail API...');
    console.log('Email details:', {
      from: authenticatedEmail,
      to,
      subject,
      messageId,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodeMessage(rawMessage) },
    });

    console.log('Email sent successfully:', res.data);
    return res.data;
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

async function fetchEmails(adminId, label = 'INBOX') {
  const gmail = await getGmailAuth(adminId);
  const res = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [label],
    q: 'category:primary',
    maxResults: 20,
  });
  console.log(res.data)
  const messages = res.data.messages || [];
  return Promise.all(messages.map(msg => getEmailById(adminId, msg.id)));
}

async function searchEmails(adminId, query = '') {
  const gmail = await getGmailAuth(adminId);
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 20,
  });

  const messages = res.data.messages || [];
  return Promise.all(messages.map(msg => getEmailById(adminId, msg.id)));
}

async function getEmailById(adminId, messageId) {
  try {
    console.log('getEmailById called with:', { adminId, messageId });
    
    const gmail = await getGmailAuth(adminId);
    // console.log('Gmail auth successful for getEmailById');
    
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    // console.log('Gmail API response received');
    const data = res.data;
    const headers = data.payload.headers;

    const getHeader = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
    const from = getHeader('From');
    const to = getHeader('To');
    const subject = getHeader('Subject');
    const date = getHeader('Date');
    const messageIdHeader = getHeader('Message-ID');
    const references = getHeader('References');

    let body = '';
    const part = data.payload.parts?.find(p => p.mimeType === 'text/html' || p.mimeType === 'text/plain');
    if (part && part.body.data) {
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (data.payload.body?.data) {
      body = Buffer.from(data.payload.body.data, 'base64').toString('utf-8');
    }

    const result = {
      id: data.id,  // Always use Gmail's internal message ID
      threadId: data.threadId,
      from,
      to,
      subject,
      date,
      messageId: messageIdHeader,  // Store the Message-ID header separately
      references,
      content: body,
      labelIds: data.labelIds,
    };
    
    // console.log('Email processed successfully:', { 
    //   id: result.id, 
    //   messageId: result.messageId, 
    //   subject: result.subject 
    // });
    
    return result;
  } catch (error) {
    console.error('Error in getEmailById:', {
      error: error.message,
      stack: error.stack,
      adminId,
      messageId
    });
    throw error;
  }
}

async function findMessageIdByHeaderId(adminId, messageIdHeader) {
  try {
    console.log('Searching for message with Message-ID:', messageIdHeader);
    
    const gmail = await getGmailAuth(adminId);
    
    // Search for the email using the Message-ID header
    const searchQuery = `rfc822msgid:${messageIdHeader}`;
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 1,
    });

    if (res.data.messages && res.data.messages.length > 0) {
      const gmailMessageId = res.data.messages[0].id;
      console.log('Found Gmail message ID:', gmailMessageId, 'for Message-ID:', messageIdHeader);
      return gmailMessageId;
    }
    
    console.log('No message found with Message-ID:', messageIdHeader);
    return null;
  } catch (error) {
    console.error('Error in findMessageIdByHeaderId:', {
      error: error.message,
      messageIdHeader
    });
    throw error;
  }
}

async function replyToEmail(adminId, messageId, replyText, attachments = []) {
  try {
    console.log('=== REPLY EMAIL DEBUG START ===');
    console.log('Input parameters:', { adminId, messageId, replyTextLength: replyText?.length, attachmentCount: attachments.length });
    
    const gmail = await getGmailAuth(adminId);
    console.log('Gmail auth successful');
    
    const admin = await Admin.findById(adminId);
    if (!admin) throw new Error('Admin not found');
    console.log('Admin found:', { adminId: admin._id, hasSignature: !!admin.emailSignature });

    // If messageId is a Message-ID header, resolve it to Gmail ID
    let actualMessageId = messageId;
    if (messageId.includes('@')) {
      console.log('Resolving Message-ID to Gmail ID...');
      const gmailId = await findMessageIdByHeaderId(adminId, messageId);
      if (!gmailId) throw new Error(`No Gmail message found with Message-ID: ${messageId}`);
      actualMessageId = gmailId;
      console.log('Resolved to Gmail ID:', actualMessageId);
    }

    // Fetch original email
    console.log('Fetching original email...');
    const original = await getEmailById(adminId, actualMessageId);
    console.log('Original email details:', {
      id: original.id,
      subject: original.subject,
      from: original.from,
      threadId: original.threadId,
      messageId: original.messageId
    });

    // Extract email from `From` header
    let replyToEmail = original.from;
    console.log("Original from field:", replyToEmail);
    const match = replyToEmail.match(/<(.+?)>/);
    if (match) {
      replyToEmail = match[1];
      console.log("Extracted email address:", replyToEmail);
    }

    // Prevent replying to self
    console.log('Getting authenticated user profile...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticatedEmail = profile.data.emailAddress;
    console.log('Authenticated email:', authenticatedEmail);
    
    if (replyToEmail.toLowerCase() === authenticatedEmail.toLowerCase()) {
      throw new Error('Cannot reply to your own email address.');
    }

    // Get thread ID and message ID for proper threading
    const threadId = original.threadId;
    const messageIdHeader = original.messageId || original.id;
    console.log('Threading info:', { threadId, messageIdHeader });

    // Prepare email content with signature
    const htmlContent = `${replyText}<br><br>${admin.emailSignature || ''}`;
    console.log('Email content prepared, length:', htmlContent.length);

    // Generate a unique Message-ID for this reply
    const newMessageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${authenticatedEmail.split('@')[1]}>`;

    // Build multipart message if there are attachments
    let raw;
    if (attachments.length > 0) {
      console.log('Building multipart message with attachments...');
      const boundary = 'boundary_xyz';
      let messageParts = [];

      // HTML content part
      messageParts.push(`--${boundary}`);
      messageParts.push('Content-Type: text/html; charset="UTF-8"');
      messageParts.push('');
      messageParts.push(htmlContent);

      // Attachment parts
      for (const file of attachments) {
        try {
          console.log('Processing attachment for reply:', {
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size
          });

          const content = fs.readFileSync(file.path).toString('base64');
          messageParts.push(`--${boundary}`);
          messageParts.push(`Content-Type: ${file.mimetype}`);
          messageParts.push('Content-Transfer-Encoding: base64');
          messageParts.push(`Content-Disposition: attachment; filename="${file.originalname}"`);
          messageParts.push('');
          messageParts.push(content);
          
          console.log('Attachment processed successfully for reply:', file.originalname);
        } catch (attachmentError) {
          console.error('Error processing attachment for reply:', file.originalname, attachmentError);
          throw new Error(`Failed to process attachment ${file.originalname}: ${attachmentError.message}`);
        }
      }

      messageParts.push(`--${boundary}--`);

      // Build headers for multipart message
      const headers = [
        `From: ${authenticatedEmail}`,
        `To: ${replyToEmail}`,
        `Subject: Re: ${original.subject || 'No Subject'}`,
        `Message-ID: ${newMessageId}`,
        `In-Reply-To: ${messageIdHeader}`,
        `References: ${messageIdHeader}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
        ''
      ].join('\r\n');

      raw = encodeMessage(headers + messageParts.join('\r\n'));
    } else {
      // Simple text message without attachments
      const headers = [
        `From: ${authenticatedEmail}`,
        `To: ${replyToEmail}`,
        `Subject: Re: ${original.subject || 'No Subject'}`,
        `Message-ID: ${newMessageId}`,
        `In-Reply-To: ${messageIdHeader}`,
        `References: ${messageIdHeader}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
        ''
      ].join('\r\n');

      raw = encodeMessage(headers + htmlContent);
    }

    console.log('Email details for sending:', {
      to: replyToEmail,
      subject: `Re: ${original.subject}`,
      threadId: threadId,
      newMessageId: newMessageId,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

    // Send the email
    console.log('Sending reply email via Gmail API...');
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        // threadId,
      },
    });

    console.log('Gmail API response:', res.data);
    console.log('=== REPLY EMAIL DEBUG END ===');
    return res.data;
  } catch (error) {
    console.error('=== REPLY EMAIL ERROR ===');
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      statusCode: error.statusCode,
      response: error.response,
      stack: error.stack
    });
    
    // Log Gmail API specific errors
    if (error.response) {
      console.error('Gmail API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    console.error('=== REPLY EMAIL ERROR END ===');
    throw error;
  }
}

async function forwardEmail(adminId, messageId, forwardTo, forwardText, attachments = []) {
  try {
    console.log('=== FORWARD EMAIL DEBUG START ===');
    console.log('Input parameters:', { 
      adminId, 
      messageId, 
      forwardTo, 
      forwardTextLength: forwardText?.length,
      attachmentCount: attachments.length 
    });
    
    const gmail = await getGmailAuth(adminId);
    console.log('Gmail auth successful');
    
    const admin = await Admin.findById(adminId);
    if (!admin) throw new Error('Admin not found');
    console.log('Admin found:', { adminId: admin._id, hasSignature: !!admin.emailSignature });

    // If messageId is a Message-ID header, resolve it to Gmail ID
    let actualMessageId = messageId;
    if (messageId.includes('@')) {
      console.log('Resolving Message-ID to Gmail ID...');
      const gmailId = await findMessageIdByHeaderId(adminId, messageId);
      if (!gmailId) throw new Error(`No Gmail message found with Message-ID: ${messageId}`);
      actualMessageId = gmailId;
      console.log('Resolved to Gmail ID:', actualMessageId);
    }

    // Fetch original email
    console.log('Fetching original email...');
    const original = await getEmailById(adminId, actualMessageId);
    console.log('Original email details:', {
      id: original.id,
      subject: original.subject,
      from: original.from,
      threadId: original.threadId,
      messageId: original.messageId
    });

    // Get authenticated user email
    console.log('Getting authenticated user profile...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const authenticatedEmail = profile.data.emailAddress;
    console.log('Authenticated email:', authenticatedEmail);

    // Generate a unique Message-ID for this forward
    const newMessageId = `<${Date.now()}.${Math.random().toString(36).substr(2, 9)}@${authenticatedEmail.split('@')[1]}>`;

    // Prepare email content with signature
    const htmlContent = `${forwardText}<br><br>${admin.emailSignature || ''}`;
    console.log('Email content prepared, length:', htmlContent.length);

    // Build multipart message if there are attachments
    let raw;
    if (attachments.length > 0) {
      console.log('Building multipart message with attachments...');
      const boundary = 'boundary_xyz';
      let messageParts = [];

      // HTML content part
      messageParts.push(`--${boundary}`);
      messageParts.push('Content-Type: text/html; charset="UTF-8"');
      messageParts.push('');
      messageParts.push(htmlContent);

      // Attachment parts
      for (const file of attachments) {
        try {
          console.log('Processing attachment for forward:', {
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size
          });

          const content = fs.readFileSync(file.path).toString('base64');
          messageParts.push(`--${boundary}`);
          messageParts.push(`Content-Type: ${file.mimetype}`);
          messageParts.push('Content-Transfer-Encoding: base64');
          messageParts.push(`Content-Disposition: attachment; filename="${file.originalname}"`);
          messageParts.push('');
          messageParts.push(content);
          
          console.log('Attachment processed successfully for forward:', file.originalname);
        } catch (attachmentError) {
          console.error('Error processing attachment for forward:', file.originalname, attachmentError);
          throw new Error(`Failed to process attachment ${file.originalname}: ${attachmentError.message}`);
        }
      }

      messageParts.push(`--${boundary}--`);

      // Build headers for multipart message
      const headers = [
        `From: ${authenticatedEmail}`,
        `To: ${forwardTo}`,
        `Subject: Fwd: ${original.subject || 'No Subject'}`,
        `Message-ID: ${newMessageId}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
        ''
      ].join('\r\n');

      raw = encodeMessage(headers + messageParts.join('\r\n'));
    } else {
      // Simple text message without attachments
      const headers = [
        `From: ${authenticatedEmail}`,
        `To: ${forwardTo}`,
        `Subject: Fwd: ${original.subject || 'No Subject'}`,
        `Message-ID: ${newMessageId}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Date: ${new Date().toUTCString()}`,
        `User-Agent: London Waste Management Gmail Integration`,
        `X-Mailer: London Waste Management System`,
        ''
      ].join('\r\n');

      raw = encodeMessage(headers + htmlContent);
    }

    console.log('Email details for sending:', {
      to: forwardTo,
      subject: `Fwd: ${original.subject}`,
      newMessageId: newMessageId,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length
    });

    // Send the email
    console.log('Sending forward email via Gmail API...');
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    console.log('Gmail API response:', res.data);
    console.log('=== FORWARD EMAIL DEBUG END ===');
    return res.data;
  } catch (error) {
    console.error('=== FORWARD EMAIL ERROR ===');
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      statusCode: error.statusCode,
      response: error.response,
      stack: error.stack
    });
    
    // Log Gmail API specific errors
    if (error.response) {
      console.error('Gmail API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    console.error('=== FORWARD EMAIL ERROR END ===');
    throw error;
  }
}

async function markAsRead(adminId, messageId) {
  const gmail = await getGmailAuth(adminId);
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}
async function moveToTrash(adminId, messageId) {
  const gmail = await getGmailAuth(adminId);
  await gmail.users.messages.trash({
    userId: 'me',
    id: messageId,
  });
}
async function getAttachment(adminId, messageId, attachmentId) {
  const gmail = await getGmailAuth(adminId);
  const attachment = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });
  return attachment.data;
}

// Test email function to verify delivery
async function sendTestEmail(adminId, to) {
  try {
    console.log('=== SENDING TEST EMAIL ===');
    const testSubject = `Test Email - ${new Date().toISOString()}`;
    const testText = `
      <h2>Test Email from London Waste Management</h2>
      <p>This is a test email to verify email delivery functionality.</p>
      <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
      <p><strong>Admin ID:</strong> ${adminId}</p>
      <p>If you receive this email, the Gmail integration is working correctly.</p>
    `;

    const result = await sendEmail(adminId, to, testSubject, testText);
    console.log('Test email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Test email failed:', error);
    throw error;
  }
}

module.exports = {
  sendEmail,
  fetchEmails,
  searchEmails,
  getEmailById,
  findMessageIdByHeaderId,
  replyToEmail,
  forwardEmail,
  markAsRead,
  moveToTrash,
  getAttachment,
  sendTestEmail
};