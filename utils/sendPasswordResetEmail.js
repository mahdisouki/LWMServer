const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

async function sendPasswordResetEmail({ to, resetUrl, firstName }) {
  const name = firstName || 'there';
  const html = addStagingBanner(`
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #ddd; border-radius: 8px; padding: 24px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1762522796/omar%27s%20new/Logo_wwspkm.png" alt="London Waste Management" style="max-width: 150px;">
      </div>
      <h2 style="color: #4CAF50; text-align: center;">Reset your password</h2>
      <p>Hi ${name},</p>
      <p>We received a request to reset your London Waste Management account password.</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${resetUrl}" style="background-color: #4CAF50; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset password</a>
      </p>
      <p style="font-size: 14px; color: #666;">This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
      <p style="font-size: 12px; color: #888; word-break: break-all;">Or copy this link: ${resetUrl}</p>
    </div>
  `);

  await transporter.sendMail({
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to,
    subject: addStagingToSubject('Reset your password'),
    html,
  });
}

module.exports = { sendPasswordResetEmail };
