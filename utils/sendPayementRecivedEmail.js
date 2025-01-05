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
  breakdown,
}) => {
  const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
      },
  });

  const breakdownHtml = breakdown
      .map((item) => `<li>${item.description}: £${item.amount}</li>`)
      .join("");

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
              <li><strong>Amount:</strong> ${currency} £${amount.toFixed(2)}</li>
              <li><strong>Payment Method:</strong> ${paymentType}</li>
          </ul>
         
          <h3>Task Details:</h3>
          <ul>
              <li><strong>Objects Position:</strong> ${taskDetails.Objectsposition}</li>
              <li><strong>Available Time Slot:</strong> ${taskDetails.available}</li>
          </ul>
          <p>Thank you for choosing London Waste Management!</p>
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
