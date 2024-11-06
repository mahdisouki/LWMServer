// controllers/gmailController.js
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { oauth2Client, getAuthUrl, setCredentials } = require('../helper/googleConfig');

const gmailCtrl = {
  authorize: (req, res) => {
    const url = getAuthUrl();
    res.redirect(url);
  },

  handleOAuthCallback: async (req, res) => {
    const code = req.query.code;
    console.log(code)
    try {
      const tokens = await setCredentials(code);
      res.send('Authentication successful! You can close this tab.');
    } catch (error) {
      res.status(500).send('Error authenticating');
    }
  },

  sendEmail: async (req, res) => {
    const { to, subject, text } = req.body;
    const accessToken = oauth2Client.credentials.access_token;

    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: 'soukimahdi@gmail.com',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: oauth2Client.credentials.refresh_token,
        accessToken: accessToken,
      },
    });

    const mailOptions = { from: 'YOUR_EMAIL@gmail.com', to, subject, text };

    try {
      const result = await transport.sendMail(mailOptions);
      res.json({ message: 'Email sent', result });
    } catch (error) {
      res.status(500).json({ message: 'Failed to send email', error });
    }
  },

  listEmails: async (req, res) => {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    try {
      // Step 1: Get the list of message IDs
      const response = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
      const messages = response.data.messages || [];

      // Step 2: Fetch full email details for each message ID
      const emailDetailsPromises = messages.map(async (message) => {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full', // Get full message details
        });
        const emailData = messageResponse.data;

        // Step 3: Extract relevant details
        const sender = emailData.payload.headers.find(header => header.name === 'From').value;
        const subject = emailData.payload.headers.find(header => header.name === 'Subject').value;
        
        // Get the email body
        let body = '';
        if (emailData.payload.parts) {
          // If there are parts, check for the plain text or HTML body
          const part = emailData.payload.parts.find(part => part.mimeType === 'text/plain' || part.mimeType === 'text/html');
          if (part) {
            body = part.body.data ? Buffer.from(part.body.data, 'base64').toString() : '';
          }
        } else {
          // Fallback if there are no parts
          body = emailData.payload.body.data ? Buffer.from(emailData.payload.body.data, 'base64').toString() : '';
        }

        // Check for attachments
        const attachments = emailData.payload.parts ? emailData.payload.parts.filter(part => part.filename && part.filename.length > 0) : [];
        
        // Determine if the email is read (you can check if it's in the 'INBOX' and not marked as 'UNREAD')
        const isRead = !emailData.labelIds.includes('UNREAD');

        return {
          sender,
          subject,
          body,
          attachments: attachments.map(att => ({
            filename: att.filename,
            mimeType: att.mimeType,
          })),
          isRead,
        };
      });

      // Wait for all promises to resolve
      const fullEmails = await Promise.all(emailDetailsPromises);

      res.json({ emails: fullEmails });
    } catch (error) {
      console.error(error); // Log the error for debugging
      res.status(500).json({ message: 'Failed to retrieve emails', error: error.message });
    }
  },
};

module.exports = gmailCtrl;
