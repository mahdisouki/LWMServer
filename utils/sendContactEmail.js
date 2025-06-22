const nodemailer = require('nodemailer');
const path = require('path');
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
    subject: `New Moving Service Request from ${contactData.fullName}`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #ddd; border-radius: 8px; padding: 20px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="cid:logo" alt="London Waste Management" style="max-width: 150px;">
      </div>
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #4CAF50;">New Moving Service Request</h2>
        <p style="font-size: 14px; color: #888;">A customer has submitted a moving service request.</p>
      </div>
      <div style="padding: 15px; background-color: #fff; border-radius: 8px; border: 1px solid #ddd;">
        <p style="margin: 10px 0; font-size: 16px;"><strong>Full Name:</strong> ${
          contactData.fullName
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Contact Number:</strong> ${
          contactData.contactNumber
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Email:</strong> ${
          contactData.email
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Pick Up Location:</strong> ${
          contactData.pickUpLocation
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Drop Off Location:</strong> ${
          contactData.dropOffLocation
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Pick Up Property Type:</strong> ${
          contactData.pickUpPropertyType
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Drop Off Property Type:</strong> ${
          contactData.dropOffPropertyType
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Packing Required:</strong> ${
          contactData.packingRequired
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Access Info:</strong> ${
          contactData.accessInfo
        }</p>
        <p style="margin: 10px 0; font-size: 16px;"><strong>Extra Info:</strong> ${
          contactData.extraInfo
        }</p>
        ${
          contactData.files && contactData.files.length > 0
            ? `<div style='margin-top: 15px;'><strong>Uploaded Files:</strong><ul>${contactData.files
                .map((f) => `<li><a href='${f}'>${f}</a></li>`)
                .join('')}</ul></div>`
            : ''
        }
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <p style="font-size: 14px; color: #888;">London Waste Management</p>
      </div>
    </div>
  `,
    attachments: [
      {
        filename: 'Green-Log.png',
        path: path.join(__dirname, '../logo/Green-Log.png'),
        cid: 'logo', // Content ID for the inline image
      },
    ],
  };

  // Email to the user
  const mailOptionsToUser = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`, // Your email
    to: contactData.email,
    subject: 'Thank you for your moving service request!',
    html: `
      <div style="padding: 40px 0 0; font-family: Arial, sans-serif; text-align: center;">
  <div style="max-width: 90%; margin: auto; background: #ffffff; border-radius: 12px 12px 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; position: relative; z-index: 2;">
    
   
    <div style="padding: 20px 0;">
      <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750544719/uploads/xpi9oph7svpwzmv1dewe.png" width="200" alt="London Waste Management" />
    </div>

  
  <div style="background: linear-gradient(to bottom, #ffffff, #dcedd6); font-weight: bold; color: #444; padding: 20px; text-align: center; font-size: 26px; border-radius: 0 0 30px 30px;">
  <span style="color: #6dc24b;">T</span><span style="color: #1a1a1a;">han</span><span style="color: #6dc24b;">k y</span><span style="color: #1a1a1a;">ou </span><span style="color: #6dc24b;">!</span>
</div>


  
    <div style="padding: 20px; display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; text-align: left; position: relative; z-index: 2;">

    
      <div style="flex: 1; padding-right: 10px;">
        <p style="font-size: 24px; margin-bottom: 20px;">
          <span style="color: #8DC044; font-weight: bold;">Dear</span>
          <span style="font-weight: bold;"> ${contactData.fullName},</span>
        </p>

        <p>Thank you for your moving service request. We have received your submission and will get back to you as soon as possible.</p>

        <p>If you have any question feel free to contact us at 
          <a href="mailto:hello@londonwastemanagement.com" style="color: #007bff;">hello@londonwastemanagement.com</a>
          or call us on <a href="tel:02030971517" style="color: #6dc24b;">02030971517</a>.
        </p>

        <p style="margin: 20px 0 5px;">Best regards,</p>
        <p style="color: #6dc24b; font-weight: bold; margin: 0;">London Waste Management Department</p>
      </div>

      
      <div style="flex-shrink: 0;">
        <img 
          src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750621891/uploads/nz1iizlrc6icasizfhtk.png" 
          alt="Thank You Character" 
          style="width: 260px; max-width: 100%; height: auto; margin-left: 30px; margin-top :75px" 
        />
      </div>
    </div>

  
    <div style="padding: 15px 20px; font-size: 12px; text-align: center; color: #666; border-top: 1px solid #eee;">
      London Waste Management |
      <a href="mailto:hello@londonwastemanagement.com" style="color: #007bff;">hello@londonwastemanagement.com</a>
    </div>

  

  </div>
</div>

    `,
  };

  // Send both emails
  await transporter.sendMail(mailOptionsToResponsible);
  await transporter.sendMail(mailOptionsToUser);
};

module.exports = sendContactEmail;
