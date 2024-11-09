const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Create a transport using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASS, // Your app-specific password (if 2FA enabled)
  },
});

// Function to send an email
const sendEmail = async (to, subject, text) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER, // Sender's email address
      to,
      subject,
      text,
    });
    return info.response;
  } catch (err) {
    throw new Error(`Error sending email: ${err.message}`);
  }
};

// IMAP connection configuration for Gmail
const imapConfig = {
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASS,
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
};

// Function to fetch emails
const fetchEmails = (callback) => {
  const imap = new Imap(imapConfig);

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) throw err;

      const fetch = imap.seq.fetch('1:*', {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
        struct: true,
      });

      fetch.on('message', (msg) => {
        let email = '';
        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            email += chunk.toString();
          });
        });

        msg.once('end', () => {
          simpleParser(email)
            .then(parsed => {
              callback(null, parsed); // Send parsed email to callback
            })
            .catch(err => {
              callback(err, null);
            });
        });
      });

      fetch.once('end', () => {
        imap.end();
      });
    });
  });

  imap.once('error', (err) => {
    callback(err, null);
  });

  imap.once('end', () => {
    console.log('IMAP connection ended');
  });

  imap.connect();
};

module.exports = {
  sendEmail,
  fetchEmails,
};
