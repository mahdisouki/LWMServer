const nodemailer = require("nodemailer");

const sendReviewRequestEmail = async ({ email, firstName, orderId }) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const internalReviewBase = `https://lwmadmin.netlify.app/review/${orderId}`;
  const trustpilotLink = `https://www.trustpilot.com/evaluate/www.londonwastemanagement.com`;

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "How Was Your Experience? | London Waste Management",
    html: `
  <div style="font-family: Arial, sans-serif; max-width: 700px; margin: auto; padding: 40px; border: 1px solid #ddd;backgroundcolor:#b1b1b1">
    <div style="align-items:center">
    <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png"  />
    </div>
    <h2 style="color: #333; text-align: center;background-color:#8dc044">Customer Review</h2>
    <p style="text-align:right; font-weight: 600;">Hi ${firstName}
Thank you for choosing LWM for your recent removal and recycling collection.
We would love it if you could help us and other customers by rating your
experience with us. It only takes a few clicks and would be sincerely
appreciated!
Kind regards,</p>

    <table width="100%" cellpadding="10" cellspacing="0" style="text-align: center; margin: 30px 0;">
      <tr>
        <td>
          <a href="${internalReviewBase}">
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/tkhlpz8mjob3ulpbhmli.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jfwffhogxomlk1z8wrbi.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jfwffhogxomlk1z8wrbi.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jfwffhogxomlk1z8wrbi.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jfwffhogxomlk1z8wrbi.webp" width="30" />
          </a>
        </td>
      </tr>
      <tr>
        <td>
          <a href="${internalReviewBase}&rating=3">
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jcnlv0d7qa3cgjikanw0.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jcnlv0d7qa3cgjikanw0.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jcnlv0d7qa3cgjikanw0.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jfwffhogxomlk1z8wrbi.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/jfwffhogxomlk1z8wrbi.webp" width="30" />
          </a>
        </td>
      </tr>
      <tr>
        <td>
          <a href="${trustpilotLink}" target="_blank">
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/ac4cq9liiy5klo9d3bew.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/ac4cq9liiy5klo9d3bew.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/ac4cq9liiy5klo9d3bew.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/ac4cq9liiy5klo9d3bew.webp" width="30" />
            <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742958518/ac4cq9liiy5klo9d3bew.webp" width="30" />
          </a>
        </td>
      </tr>
    </table>

    <p style="text-align:center; font-size: 14px; color: #777;">Click on the stars to rate your experience.</p>

    <hr style="margin: 40px 0;">

    <footer style="text-align: center; font-size: 12px; color: #888;">
      <p>London Waste Management</p>
      <p>Email: hello@londonwastemanagement.com</p>
    </footer>
  </div>
`
,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Review email sent to ${email}`);
  } catch (err) {
    console.error("Error sending review email:", err);
  }
};

module.exports = sendReviewRequestEmail;
