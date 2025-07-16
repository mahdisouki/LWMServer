const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const sendReviewRequestEmail = async ({ email, firstName, orderId }) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  // Read the HTML template
  const templatePath = path.join(__dirname, '../public/templates/review.html');
  let template = fs.readFileSync(templatePath, 'utf8');

  // Prepare dynamic links
  const internalReviewBase = `https://lwmadmin.netlify.app/review/${orderId}`;
  const trustpilotLink = `https://www.trustpilot.com/evaluate/www.londonwastemanagement.com`;

  // Replace placeholders in the template
  template = template.replace(/Texty Text/g, firstName);
  template = template.replace(/__ORDER_ID__/g, orderId);
  template = template.replace(/__INTERNAL_REVIEW_LINK__/g, internalReviewBase);
  template = template.replace(/__TRUSTPILOT_LINK__/g, trustpilotLink);

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "How Was Your Experience? | London Waste Management",
    html: template,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Review email sent to ${email}`);
  } catch (err) {
    console.error("Error sending review email:", err);
  }
};

module.exports = sendReviewRequestEmail;
