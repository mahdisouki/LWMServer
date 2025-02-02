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

        const totalMessages = box.messages.total;
        const fetchRangeStart = totalMessages - 19 > 0 ? totalMessages - 19 : 1;
        const fetchRange = `${fetchRangeStart}:${totalMessages}`;

        console.log(`Fetching emails from ID: ${fetchRangeStart} to ID: ${totalMessages}`);

        const f = imap.fetch(fetchRange, {
          bodies: '',
          struct: true,
          markSeen: false,
        });

        f.on('message', (msg, seqno) => {
          let email = '';
          let attributes;

          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              email += chunk.toString();
            });
          });

          msg.on('attributes', (attrs) => {
            attributes = attrs;
          });

          msg.once('end', () => {
            simpleParser(email)
              .then(async (parsed) => {
                const { from, subject, date, text, html, attachments } = parsed;

                // Extract sender name and email
                const senderName = from?.value[0]?.name || 'Unknown';
                const senderEmail = from?.value[0]?.address || 'Unknown';
                const timestamp = date ? date.getTime() : Date.now();

                // Determine if the email is unread
                const flags = attributes.flags;
                const unread = !flags.includes('\\Seen');
                const important = flags.includes('\\Flagged');

                // Process attachments
                const processedAttachments = [];
                if (attachments && attachments.length > 0) {
                  for (const attachment of attachments) {
                    processedAttachments.push({
                      id: attachment.checksum || attachment.filename,
                      filename: attachment.filename,
                      contentType: attachment.contentType,
                      content: attachment.content.toString('base64'),
                    });
                  }
                }

                const formattedEmail = {
                  id: attributes.uid || seqno,
                  category: 'inbox',
                  senderName,
                  senderEmail,
                  subject: subject || 'No Subject',
                  preview: text ? text.substring(0, 100) : '',
                  content: html || text || 'No Content',
                  timestamp,
                  date: date || new Date(),
                  unread,
                  important,
                  attachments: processedAttachments,
                };

                emails.push(formattedEmail);
              })
              .catch((err) => {
                console.error('Error parsing email:', err);
              });
          });
        });

        f.once('error', (err) => {
          console.error('Fetch error: ' + err);
          reject(err);
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
// Function to reply to an email
const replyToEmail = async (emailId, text) => {
  try {
    // Fetch the original email to get necessary headers
    const originalEmail = await fetchEmailById(emailId);

    const replyOptions = {
      from: process.env.EMAIL_USER,
      to: originalEmail.from, // Replying to sender
      subject: `Re: ${originalEmail.subject}`, // Keeping the subject line
      text: `${text}\n\nOn ${originalEmail.subject}, ${originalEmail.from} wrote:\n${originalEmail.text}`,
      html: `<p>${text}</p><br><blockquote>${originalEmail.html}</blockquote>`, // Threaded reply in HTML
      inReplyTo: originalEmail.messageId,
      references: `${originalEmail.references} ${originalEmail.messageId}`,
    };

    const info = await transporter.sendMail(replyOptions);
    return info.response;
  } catch (err) {
    throw new Error(`Error replying to email: ${err.message}`);
  }
};

module.exports = {
  sendEmail,
  fetchEmails,
  replyToEmail,
  
};
