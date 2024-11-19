const nodemailer = require('nodemailer');

const sendContactEmail = async ({ responsibleEmail, contactData }) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // Use the email you want to send from
      pass: process.env.EMAIL_PASSWORD, // App password or email password
    },
  });

  // Email to the responsible person
  const mailOptionsToResponsible = {
    from: `"London Waste Management"<${contactData.email}>`,
    to: responsibleEmail,
    subject: `New Contact Request from ${contactData.fullName}`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background-color: #f9f9f9;">
       <div style="text-align: center; margin-bottom: 20px;">
          <img src="cid:logo" alt="London Waste Management" style="max-width: 150px;">
        </div>
    <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4CAF50;">New Contact Request</h2>
        <p style="font-size: 14px; color: #888;">A customer has contacted you through the system.</p>
      </div>
      <div style="padding: 15px; background-color: #fff; border-radius: 8px; border: 1px solid #ddd;">
        <p style="margin: 10px 0; font-size: 16px;"><strong>Full Name:</strong> ${contactData.fullName}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Email:</strong> ${contactData.email}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Message:</strong></p>
        <p style="margin: 10px 0; font-size: 14px; background-color: #f2f2f2; padding: 10px; border-radius: 4px; font-style: italic;">
          ${contactData.message}
        </p>
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <p style="font-size: 14px; color: #888;">London Waste Management</p>
      </div>
    </div>
  `,
  attachments: [
    {
      filename: 'Green-Log.png',
      path: 'D:\\Users\\eya20\\LondonWaste\\LWMServer\\logo\\Green-Log.png',
      cid: 'logo', // Content ID for the inline image
    },
  ],
};

  // Email to the user
  const mailOptionsToUser = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`, // Your email
    to: contactData.email,
    subject: "Thank you for contacting us!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e5e5e5; border-radius: 8px; background-color: #f3fdf3;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="cid:logo" alt="London Waste Management" style="max-width: 150px;">
        </div>
        <div style="text-align: center; padding: 20px; background-color: #e9ffe9; border-radius: 8px;">
          <h2 style="color: #004d00; font-size: 24px;">Thank You!</h2>
          <p style="font-size: 16px; color: #333;"> <strong>Dear ${contactData.fullName},</strong></p>
          <p style="font-size: 16px; color: #333;">Thank you for reaching out to us. We have received your message and will get back to you as soon as possible.
          </p>
                  <p style="font-size: 16px; color: #333;"If you have any questions, feel free to contact us.</p>
                    <p style="font-size: 16px; color: #333;"Best regards, </p>
                    <p style="font-size: 16px; color: #333;">London Waste Management </p>
                  </div>
      </div>
    `,
    attachments: [
      {
        filename: 'Green-Log.png',
        path: 'D:\\Users\\eya20\\LondonWaste\\LWMServer\\logo\\Green-Log.png',
        cid: 'logo', // Content ID for the inline image
      },
    ],
  };

  // Send both emails
  await transporter.sendMail(mailOptionsToResponsible);
  await transporter.sendMail(mailOptionsToUser);
};

module.exports = sendContactEmail;
