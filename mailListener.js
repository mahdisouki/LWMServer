const Imap = require('imap');
const { fetchEmails } = require('./services/mailingService');
const { emitNotificationToUser } = require('./socket');
const { User } = require('./models/User');
const imapConfig = {
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASSWORD,
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
};

let lastSeenEmailId = null;

function startMailListener() {
  const imap = new Imap(imapConfig);

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) throw err;
      console.log('IMAP ready and listening for new mail...');
    });
  });

  imap.on('mail', async (numNewMsgs) => {
    try {
      const emails = await fetchEmails();
      if (emails.length > 0) {
        const latestEmail = emails[0];
        if (latestEmail.id !== lastSeenEmailId) {
          lastSeenEmailId = latestEmail.id;
          // Notify all Admin users
          const users = await User.find({ role: { $in: ['Admin'] } });
          for (const user of users) {
            emitNotificationToUser(
              user._id.toString(),
              'Emails',
              `New email from ${latestEmail.senderName || latestEmail.senderEmail}: ${latestEmail.subject}`
            );
          }
        }
      }
    } catch (err) {
      console.error('Error in mail listener:', err);
    }
  });

  imap.once('error', (err) => {
    console.error('IMAP error:', err);
    // Optionally, restart the listener after a delay
    setTimeout(startMailListener, 60000);
  });

  imap.once('end', () => {
    console.log('IMAP connection ended, restarting...');
    setTimeout(startMailListener, 60000);
  });

  imap.connect();
}

module.exports = { startMailListener }; 