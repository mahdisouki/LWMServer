const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { oauth2Client, getAuthUrl, setCredentials, refreshAccessToken } = require('../helper/googleConfig');

const gmailCtrl = {
  authorize: (req, res) => {
    const url = getAuthUrl();
    res.redirect(url);
  },

  handleOAuthCallback: async (req, res) => {
    const code = req.query.code;
    try {
      const tokens = await setCredentials(code);
      console.log(tokens)
      res.send('Authentication successful! You can close this tab.');
    } catch (error) {
      res.status(500).send('Error authenticating');
    }
  },

  sendEmail: async (req, res) => {
    await refreshAccessToken(); // Ensure we have a valid access token
    const { to, subject, text } = req.body;
    const accessToken = oauth2Client.credentials.access_token;
    console.log("refrsh from env",process.env.GOOGLE_REFRESH_TOKEN)
    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: 'soukimahdi@gmail.com',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        accessToken: accessToken,
      },
    });

    const mailOptions = { from: 'soukimahdi@gmail.com', to, subject, text };

    try {
      const result = await transport.sendMail(mailOptions);
      res.json({ message: 'Email sent', result });
    } catch (error) {
      res.status(500).json({ message: 'Failed to send email', error });
    }
  },

  listEmails: async (req, res) => {
    await refreshAccessToken(); // Ensure we have a valid access token
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      const response = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
      const messages = response.data.messages || [];

      const emailDetailsPromises = messages.map(async (message) => {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full',
        });
        const emailData = messageResponse.data;

        const sender = emailData.payload.headers.find(header => header.name === 'From').value;
        const subject = emailData.payload.headers.find(header => header.name === 'Subject').value;
        let body = '';
        if (emailData.payload.parts) {
          const part = emailData.payload.parts.find(part => part.mimeType === 'text/plain' || part.mimeType === 'text/html');
          if (part) {
            body = part.body.data ? Buffer.from(part.body.data, 'base64').toString() : '';
          }
        } else {
          body = emailData.payload.body.data ? Buffer.from(emailData.payload.body.data, 'base64').toString() : '';
        }

        const attachments = emailData.payload.parts ? emailData.payload.parts.filter(part => part.filename && part.filename.length > 0) : [];
        const isRead = !emailData.labelIds.includes('UNREAD');

        return {
          sender,
          subject,
          body,
          attachments: attachments.map(att => ({ filename: att.filename, mimeType: att.mimeType })),
          isRead,
        };
      });

      const fullEmails = await Promise.all(emailDetailsPromises);
      res.json({ emails: fullEmails });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to retrieve emails', error: error.message });
    }
  },
};

module.exports = gmailCtrl;
