const nodemailer = require("nodemailer");

const sendReviewRequestEmail = async ({ email, firstName, orderId }) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const internalReviewBase = `https://www.londonwastemanagement.com/customer-review/?order_id=${orderId}`;
  const trustpilotLink = `https://www.trustpilot.com/evaluate/www.londonwastemanagement.com`;

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "How Was Your Experience? | London Waste Management",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: auto; padding: 40px; border: 1px solid #ddd;">
        <h2 style="color: #333; text-align: center;">Customer Review</h2>
        <p style="text-align:center; font-weight: 600;">How Was Your Experience?</p>
        
        <div style="display: flex; flex-direction: column; align-items: center; gap: 15px; margin: 30px 0;">

          <!-- 1 STAR -->
          <a href="${internalReviewBase}&rating=1" style="text-decoration: none;">
            <img src="https://londonwaste.duckdns.org/logo/1-star.webp" alt="1 star review" style="max-width: 300px;">
          </a>

          <!-- 3 STARS -->
          <a href="${internalReviewBase}&rating=3" style="text-decoration: none;">
            <img src="https://londonwaste.duckdns.org/logo/1-star.webp" alt="3 stars review" style="max-width: 300px;">
          </a>

          <!-- 5 STARS - trustpilot -->
          <a href="${trustpilotLink}" target="_blank" style="text-decoration: none;">
            <img src="https://londonwaste.duckdns.org/logo/1-star.webp" alt="5 stars review" style="max-width: 300px;">
          </a>

        </div>

        <p style="text-align:center; font-size: 14px; color: #777;">Click on the stars to rate your experience.</p>

        <hr style="margin: 40px 0;">

        <footer style="text-align: center; font-size: 12px; color: #888;">
          <p>London Waste Management</p>
          <p>Email: hello@londonwastemanagement.com</p>
        </footer>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Review email sent to ${email}`);
  } catch (err) {
    console.error("Error sending review email:", err);
  }
};

module.exports = sendReviewRequestEmail;
