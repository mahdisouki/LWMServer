const nodemailer = require('nodemailer');

const sendQuotationEmail = async ({ responsibleEmail, quotationData }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail', // Use 'gmail' or another email provider
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Generate list of item URLs instead of embedding images
    const isVideoUrl = (url) => {
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];
        const lowerUrl = url.toLowerCase();
        return videoExtensions.some(ext => lowerUrl.includes(ext)) || lowerUrl.includes('/video/');
    };

    const itemsListHTML = quotationData.items && quotationData.items.length > 0
        ? quotationData.items
            .map((item, index) => {
                const itemType = isVideoUrl(item) ? 'Video' : 'Image';
                return `<li style="margin: 5px 0;"><a href="${item}" target="_blank" style="color: #4CAF50; text-decoration: none;">Item ${index + 1} - View ${itemType}</a></li>`;
            })
            .join('')
        : '<li>No items uploaded</li>';

    const mailOptionsToResponsible = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: responsibleEmail, // Adresse email du responsable
        replyTo: quotationData.email, // Replies go directly to the customer
        subject: `New Quotation Request from ${quotationData.firstName || ''} ${quotationData.lastName || ''}`.trim(),
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9; padding: 20px;">
           <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1762522796/omar%27s%20new/Logo_wwspkm.png" alt="London Waste Management" style="max-width: 150px;">
        </div> 
        <h2 style="text-align: center; color: #4CAF50; margin-bottom: 20px;">New Quotation Request</h2>
            <p style="font-size: 16px; margin-bottom: 10px;">
                <strong>First Name:</strong> ${quotationData.firstName || 'Not provided'}
            </p>
            <p style="font-size: 16px; margin-bottom: 10px;">
                <strong>Last Name:</strong> ${quotationData.lastName || 'Not provided'}
            </p>
            <p style="font-size: 16px; margin-bottom: 10px;">
                <strong>Address:</strong> ${quotationData.line1} ${quotationData.line2}, ${quotationData.postcode}
            </p>
            <p style="font-size: 16px; margin-bottom: 10px;">
                <strong>Email:</strong> ${quotationData.email}
            </p>
            <p style="font-size: 16px; margin-bottom: 10px;">
                <strong>Phone Number:</strong> ${quotationData.phoneNumber}
            </p>

            <p style="font-size: 16px; margin-bottom: 10px;">
                <strong>Comments:</strong> ${quotationData.comments || 'No additional comments'}
            </p>
            <h3 style="margin-top: 20px; margin-bottom: 10px; color: #4CAF50;">Uploaded Items (${quotationData.items ? quotationData.items.length : 0}):</h3>
            <div style="padding: 10px; background-color: #fff; border-radius: 4px; border: 1px solid #ddd;">
                <ul style="list-style-type: none; padding: 0; margin: 0;">
                    ${itemsListHTML}
                </ul>
            </div>
            <footer style="text-align: center; margin-top: 20px; color: #888; font-size: 14px;">
                <p>Thank you for using London Waste Management!</p>
            </footer>
        </div>
    `,
    };

    // Send to responsible email
    await transporter.sendMail(mailOptionsToResponsible);

    // Automatic reply to the user - COMMENTED OUT to avoid duplicate emails
    // The user already receives a confirmation email via sendQuoteRequestConfirmationEmail in quotationRequestController.js
    // const mailOptionsToUser = {
    //     from: ` "London Waste Management" <${process.env.EMAIL_USER}>`,
    //     to: quotationData.email, // User's email
    //     subject: `Thank You for Your Quotation Request`,
    //     html: `
    //   <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e5e5e5; border-radius: 8px; background-color: #f3fdf3;">
    //     <div style="text-align: center; margin-bottom: 20px;">
    //       <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1762522796/omar%27s%20new/Logo_wwspkm.png" alt="London Waste Management" style="max-width: 150px;">
    //     </div>
    //     <div style="text-align: center; padding: 20px; background-color: #e9ffe9; border-radius: 8px;">
    //       <h2 style="color: #004d00; font-size: 24px;">Thank You!</h2>
    //       <p style="font-size: 16px; color: #333;"> <strong>Dear, ${quotationData.email}</strong>,</p>
    //       <p style="font-size: 16px; color: #333;">Thank you for your quotation request. We have received your submission and will get back to you shortly.</p>
    //       <p style="font-size: 16px; color: #333;">If you have any questions, feel free to contact us.</p>
    //       <p style="font-size: 16px; color: #333;">Best regards,</p>
    //       <p style="font-size: 16px; color: #333;">London Waste Management</p>
    //     </div>
    //   </div>
    // `,
    // };

    // Send auto-reply email
    // await transporter.sendMail(mailOptionsToUser);
};

module.exports = sendQuotationEmail;
