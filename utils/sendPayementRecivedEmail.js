const nodemailer = require("nodemailer");

const sendPaymentConfirmationEmail = async ({
  email,
  firstName,
  lastName,
  orderId,
  paymentDate,
  amount,
  currency,
  paymentType,
  taskDetails,
}) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Payment Confirmation for Task #${orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; line-height: 1.6;">
        <img src="cid:logo" alt="London Waste Management" style="width: 150px; display: block; margin: 0 auto 20px;">
        <h2 style="background-color: #4CAF50; color: white; text-align: center; padding: 10px 0; margin: 0;">Payment Confirmation</h2>
        <p>Dear ${firstName} ${lastName},</p>
        <p>We have successfully received your payment for Task #${orderId}.</p>
        <p><strong>Payment Details:</strong></p>
        <ul>
          <li><strong>Date:</strong> ${paymentDate}</li>
          <li><strong>Amount:</strong> ${currency} ${amount.toFixed(2)}</li>
          <li><strong>Payment Method:</strong> ${paymentType}</li>
        </ul>
        <p><strong>Task Details:</strong></p>
        <ul>
          <li><strong>Task ID:</strong> ${orderId}</li>
          <li><strong>Object:</strong> ${taskDetails.object}</li>
          <li><strong>Location:</strong> ${taskDetails.location?.address || "N/A"}</li>
          <li><strong>Date:</strong> ${taskDetails.date}</li>
        </ul>
        <p>Thank you for choosing London Waste Management!</p>
        <p>If you have any questions, feel free to contact us.</p>
      </div>
    `,
    attachments: [
      {
        filename: "Green-Log.png",
        path: "D:\\Users\\eya20\\LondonWaste\\LWMServer\\logo\\Green-Log.png",
        cid: "logo",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
  console.log(`Payment confirmation email sent to ${email}`);
};

module.exports = sendPaymentConfirmationEmail;
