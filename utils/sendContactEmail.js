// utils/sendContactEmail.js
const nodemailer = require('nodemailer');

const sendContactEmail = async ({ responsibleEmail, contactData }) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // Use the email you want to send from
      pass: process.env.EMAIL_PASSWORD, // App password or email password
    },
  });

  const mailOptions = {
    from: `"${contactData.fullName}" <${contactData.email}>`,
    to: responsibleEmail,
    subject: `New Contact Request from ${contactData.fullName}`,
    text: `
    You have a new contact request.

    Details:
    - Full Name: ${contactData.fullName}
    - Email: ${contactData.email}
    - Message: ${contactData.message}
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendContactEmail;
