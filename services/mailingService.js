const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const quotedPrintable = require('quoted-printable');

// Create a transport using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Your app-specific password (if 2FA enabled)
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
  password: process.env.EMAIL_PASSWORD,
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: {
    rejectUnauthorized: false, // Accept self-signed certificates
  },
};



const fetchEmails = () => {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          return reject(err);
        }

        console.log(`Total emails in inbox: ${box.messages.total}`);

        // Search for the last 10 emails (you can modify this search as needed)
        const fetchRange = box.messages.total - 9 > 0 ? box.messages.total - 9 : 1; // Ensure not to exceed total count
        console.log(`Fetching emails from ID: ${fetchRange} to ID: ${box.messages.total}`);

        // Fetch the last 10 emails
        const f = imap.fetch(`${fetchRange}:${box.messages.total}`, { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)', 'TEXT'] });

        f.on('message', (msg) => {
          let email = '';
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              email += chunk.toString();
            });
          });

          msg.once('end', () => {
            simpleParser(email)
              .then((parsed) => {
                const formattedEmail = {
                  sender: parsed.from?.text || 'Unknown',
                  subject: parsed.subject || 'No Subject',
                  body: parsed.text || 'No Body',
                  attachments: parsed.attachments?.map((att) => ({
                    filename: att.filename,
                    contentType: att.contentType,
                  })) || [],
                };

                emails.push(formattedEmail);
              })
              .catch((err) => {
                console.error('Error parsing email:', err);
              });
          });
        });

        f.once('end', () => {
          imap.end(); // Close IMAP connection
          resolve(emails); // Return the emails
        });
      });
    });

    imap.once('error', (err) => {
      reject(err);
    });

    imap.once('end', () => {
      console.log('Connection ended');
    });

    imap.connect();
  });
};
module.exports = {
  sendEmail,
  fetchEmails,
};
