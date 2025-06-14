const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const quotedPrintable = require('quoted-printable');
const Admin = require('../models/Admin');

// Create a transport using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Your app-specific password (if 2FA enabled)
  },
 
});

// Function to send an email
const sendEmail = async (to, subject, text, adminId = null) => {
  try {
    let htmlContent = text;
    
    // If adminId is provided, get their signature
    if (adminId) {
      const admin = await Admin.findById(adminId);
      if (admin && admin.emailSignature) {
        // Convert text to HTML if it's plain text
        if (!text.includes('<')) {
          htmlContent = text.split('\n').map(line => `<p>${line}</p>`).join('');
        }
        htmlContent += admin.emailSignature;
      }
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER, // Sender's email address
      to,
      subject,
      html: htmlContent,
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
  console.log(process.env.EMAIL_USER, process.env.EMAIL_PASSWORD)
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);

        // Search for only Primary category emails
        imap.search([['X-GM-RAW', 'category:primary']], (err, results) => {
          if (err) return reject(err);

          // Get the last 20 UIDs
          const lastUIDs = results.slice(-20);

          if (lastUIDs.length === 0) {
            imap.end();
            return resolve([]);
          }

          let parsedCount = 0;

          const f = imap.fetch(lastUIDs, {
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
                  const senderName = from?.value[0]?.name || 'Unknown';
                  const senderEmail = from?.value[0]?.address || 'Unknown';
                  const timestamp = date ? date.getTime() : Date.now();
                  const flags = attributes.flags;
                  const unread = !flags.includes('\\Seen');
                  const important = flags.includes('\\Flagged');
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
                  parsedCount++;
                  if (parsedCount === lastUIDs.length) {
                    imap.end();
                    // Sort emails by date in descending order (most recent first)
                    const sortedEmails = emails.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(sortedEmails);
                  }
                })
                .catch((err) => {
                  console.error('Error parsing email:', err);
                  parsedCount++;
                  if (parsedCount === lastUIDs.length) {
                    imap.end();
                    const sortedEmails = emails.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(sortedEmails);
                  }
                });
            });
          });

          f.once('error', (err) => {
            console.error('Fetch error: ' + err);
            reject(err);
          });

          // Do not resolve here! Wait for all messages to be parsed.
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

const fetchEmailById = (emailId) => {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          return reject(err);
        }

        // Fetch the email with the specific UID
        const f = imap.fetch(emailId, {
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
              .then((parsed) => {
                const { from, subject, date, text, html, messageId, references } = parsed;

                const formattedEmail = {
                  id: attributes.uid || seqno,
                  from: from?.value[0]?.address || 'Unknown',
                  senderName: from?.value[0]?.name || 'Unknown',
                  subject: subject || 'No Subject',
                  text: text || '',
                  html: html || '',
                  date: date || new Date(),
                  messageId: messageId || '',
                  references: references || '',
                };

                resolve(formattedEmail);
              })
              .catch((err) => {
                console.error('Error parsing email:', err);
                reject(err);
              });
          });
        });

        f.once('error', (err) => {
          console.error('Fetch error:', err);
          reject(err);
        });

        f.once('end', () => {
          imap.end();
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
const replyToEmail = async (emailId, text, adminId = null) => {
  try {
    // Fetch the original email to get necessary headers
    const originalEmail = await fetchEmailById(emailId);

    let htmlContent = text;
    
    // If adminId is provided, get their signature
    if (adminId) {
      const admin = await Admin.findById(adminId);
      if (admin && admin.emailSignature) {
        // Convert text to HTML if it's plain text
        if (!text.includes('<')) {
          htmlContent = text.split('\n').map(line => `<p>${line}</p>`).join('');
        }
        htmlContent += admin.emailSignature;
      }
    }

    const replyOptions = {
      from: process.env.EMAIL_USER,
      to: originalEmail.from,
      subject: `Re: ${originalEmail.subject}`,
      text: `${text}\n\nOn ${originalEmail.subject}, ${originalEmail.from} wrote:\n${originalEmail.text}`,
      html: `<p>${htmlContent}</p><br><blockquote>${originalEmail.html}</blockquote>`,
      inReplyTo: originalEmail.messageId,
      references: `${originalEmail.references} ${originalEmail.messageId}`,
    };

    const info = await transporter.sendMail(replyOptions);
    return info.response;
  } catch (err) {
    throw new Error(`Error replying to email: ${err.message}`);
  }
};

const markEmailAsRead = (emailId) => {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);
        imap.addFlags(emailId, '\\Seen', (err) => {
          imap.end();
          if (err) return reject(err);
          resolve(true);
        });
      });
    });
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
};

module.exports = {
  sendEmail,
  fetchEmails,
  replyToEmail,
  markEmailAsRead,
};
