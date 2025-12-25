const nodemailer = require('nodemailer');

const sendGeneralContactEmail = async ({ responsibleEmail, contactData }) => {
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  // Email to the responsible person
  const mailOptionsToResponsible = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: responsibleEmail,
    replyTo: contactData.email, // Replies go directly to the customer
    bcc: process.env.EMAIL_USER, // BCC the sender (responsible person)
    subject: `New Contact Request from ${contactData.fullName}`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1762522796/omar%27s%20new/Logo_wwspkm.png" alt="London Waste Management" style="max-width: 150px;">
      </div>
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4CAF50;">New Contact Request</h2>
        <p style="font-size: 14px; color: #888;">A customer has submitted a contact request.</p>
      </div>
      <div style="padding: 15px; background-color: #fff; border-radius: 8px; border: 1px solid #ddd;">
        <p style="margin: 10px 0; font-size: 16px;"><strong>Full Name:</strong> ${contactData.fullName}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Email:</strong> ${contactData.email}</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Message:</strong></p>
        <div style="margin: 10px 0; padding: 10px; background-color: #f5f5f5; border-radius: 4px; border-left: 4px solid #4CAF50;">
          ${contactData.message.replace(/\n/g, '<br>')}
        </div>
        <p style="margin: 10px 0; font-size: 14px; color: #666;"><strong>Submitted:</strong> ${new Date(contactData.createdAt).toLocaleString()}</p>
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <p style="font-size: 14px; color: #888;">London Waste Management</p>
      </div>
    </div>
  `,
  };

  // Email to the user (confirmation)
  const mailOptionsToUser = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: contactData.email,
    bcc: process.env.EMAIL_USER, // BCC the sender (responsible person)
    subject: 'Thank you for contacting London Waste Management!',
    html: `
      <div style="padding: 40px 0 0; font-family: Arial, sans-serif; text-align: center;">
        <div style="max-width: 90%; margin: auto; background: #ffffff; border-radius: 12px 12px 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; position: relative; z-index: 2;">
          
          <div style="padding: 20px 0;">
            <img src="https://res.cloudinary.com/ddcsuzef0/image/upload/v1751659277/logo_cr9bor.png" width="200" alt="London Waste Management" />
          </div>

          <div style="background: linear-gradient(to bottom, #ffffff, #dcedd6); font-weight: bold; color: #444; padding: 20px; text-align: center; font-size: 26px; border-radius: 0 0 30px 30px;">
            <span style="color: #8DC044;">T</span><span style="color: #1a1a1a;">han</span><span style="color: #8DC044;">k y</span><span style="color: #1a1a1a;">ou </span><span style="color: #8DC044;">!</span>
          </div>

          <div style="padding: 20px; display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; text-align: left; position: relative; z-index: 2;">
            
            <div style="flex: 1; padding-right: 10px;">
              <p style="font-size: 24px; margin-bottom: 20px;">
                <span style="color: #8DC044; font-weight: bold;">Dear</span>
                <span style="font-weight: bold;"> ${contactData.fullName},</span>
              </p>

              <p>Thank you for contacting London Waste Management. We have received your message and will get back to you as soon as possible.</p>

              <p>If you have any urgent questions, feel free to contact us at 
                <a href="mailto:hello@londonwastemanagement.com" style="color: #8DC044;">hello@londonwastemanagement.com</a>
                or call us on <a href="tel:02030971517" style="color: #8DC044;">020 30971517</a>.
              </p>

              <p style="margin: 20px 0 5px;">Best regards,</p>
              <p style="color: #8DC044; font-weight: bold; margin: 0;">London Waste Management Team</p>
            </div>

            <div style="flex-shrink: 0;">
              <img 
                src="https://res.cloudinary.com/ddcsuzef0/image/upload/v1751659277/logo_cr9bor.png" 
                alt="Thank You Character" 
                style="width: 260px; max-width: 100%; height: auto; margin-left: 30px; margin-top: 75px" 
              />
            </div>
          </div>

          <div style="padding: 15px 20px; font-size: 12px; text-align: center; color: #666; border-top: 1px solid #eee;">
            London Waste Management |
            <a href="mailto:hello@londonwastemanagement.com" style="color: #8DC044;">hello@londonwastemanagement.com</a> | 020 30971517
          </div>
        </div>
      </div>
    `,
  };

  // Send both emails
  await transporter.sendMail(mailOptionsToResponsible);
  await transporter.sendMail(mailOptionsToUser);
};

module.exports = sendGeneralContactEmail;


