const nodemailer = require('nodemailer');

const sendQuotationEmail = async ({ responsibleEmail, quotationData }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail', // Use 'gmail' or another email provider
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Email to the responsible party
    const imagesHTML = quotationData.items
        .map(
            (item) =>
                `<img src="${item}" style="max-width: 300px; display: block; margin-top: 10px;" alt="Uploaded Item Image" />`
        )
        .join('');

    const mailOptionsToResponsible = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: responsibleEmail, // Adresse email du responsable
        subject: `New Quotation Request`,
        html: `
            <p><strong>New Quotation Request</strong></p>
            <p>From: ${quotationData.line1} ${quotationData.line2}</p>
            <p>Email: ${quotationData.email}</p>
            <p>Phone Number: ${quotationData.phoneNumber}</p>
            <p>Address: ${quotationData.roadName}, ${quotationData.town}, ${quotationData.postcode}</p>
            <p>Comments: ${quotationData.comments}</p>
            <p><strong>Uploaded Items:</strong></p>
            ${imagesHTML} <!-- Les images sont intégrées directement dans l'email -->
        `,
    };

    // Send to responsible email
    await transporter.sendMail(mailOptionsToResponsible);

    // Automatic reply to the user
    const mailOptionsToUser = {
        from: ` "London Waste Management" <${process.env.EMAIL_USER}>`,
        to: quotationData.email, // User's email
        subject: `Thank You for Your Quotation Request`,
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e5e5e5; border-radius: 8px; background-color: #f3fdf3;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="cid:logo" alt="London Waste Management" style="max-width: 150px;">
        </div>
        <div style="text-align: center; padding: 20px; background-color: #e9ffe9; border-radius: 8px;">
          <h2 style="color: #004d00; font-size: 24px;">Thank You!</h2>
          <p style="font-size: 16px; color: #333;"> <strong>Dear, ${quotationData.email}</strong>,</p>
          <p style="font-size: 16px; color: #333;">Thank you for your quotation request. We have received your submission and will get back to you shortly.</p>
                  <p style="font-size: 16px; color: #333;"If you have any questions, feel free to contact us.</p>
                    <p style="font-size: 16px; color: #333;"Best regards,</p>
                    <p style="font-size: 16px; color: #333;">London Waste Management
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

    // Send auto-reply email
    await transporter.sendMail(mailOptionsToUser);
};

module.exports = sendQuotationEmail;
