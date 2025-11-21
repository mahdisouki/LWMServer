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
  const trustpilotLink = `https://www.trustpilot.com/evaluate/www.londonwastemanagement.com`;

  // Encode the name for URL parameter
  const encodedName = encodeURIComponent(firstName);

  // For ratings 1-3, link to feedback page with name parameter
  const feedbackLink1 = `https://client.londonwastemanagement.com/feedback?name=${encodedName}&rating=1`;
  const feedbackLink2 = `https://client.londonwastemanagement.com/feedback?name=${encodedName}&rating=2`;
  const feedbackLink3 = `https://client.londonwastemanagement.com/feedback?name=${encodedName}&rating=3`;

  // For ratings 4-5, link to Trustpilot
  // (rating 4 and 5 both go to Trustpilot)

  // Replace placeholders in the template
  template = template.replace(/{{FULL_NAME}}/g, firstName);
  template = template.replace(/{{FEEDBACK_LINK_1}}/g, feedbackLink1);
  template = template.replace(/{{FEEDBACK_LINK_2}}/g, feedbackLink2);
  template = template.replace(/{{FEEDBACK_LINK_3}}/g, feedbackLink3);
  template = template.replace(/{{TRUSTPILOT_LINK}}/g, trustpilotLink);

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
