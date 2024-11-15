const nodemailer = require('nodemailer');

const sendQuotationEmail = async ({ responsibleEmail, quotationData }) => {
    // Set up transporter with basic SMTP using email and app password
    const transporter = nodemailer.createTransport({
        service: 'gmail',  // Use 'gmail' or your email provider's service name
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Build HTML for each image
    const imagesHTML = quotationData.items.map(item => `<img src="${item}" style="max-width: 300px; display: block; margin-top: 10px;" alt="Uploaded Item Image" />`).join('');

    const mailOptions = {
        from: `"${quotationData.firstName} ${quotationData.lastName}" <${process.env.EMAIL_USER}>`,
        to: responsibleEmail,  // The email receiving the requests
        subject: `New Quotation Request`,
        html: `
            <p>You have a new quotation request from ${quotationData.firstName} ${quotationData.lastName}.</p>
            
            <p><strong>Details:</strong></p>
            <ul>
                <li><strong>Email:</strong> ${quotationData.email}</li>
                <li><strong>First Name:</strong> ${quotationData.firstName}</li>
                <li><strong>Last Name:</strong> ${quotationData.lastName}</li>
                <li><strong>Phone Number:</strong> ${quotationData.phoneNumber}</li>
                <li><strong>Address:</strong> ${quotationData.doorNumberOrBuildingName}, ${quotationData.roadName}, ${quotationData.town}, ${quotationData.postcode}</li>
                <li><strong>Comments:</strong> ${quotationData.comments}</li>
            </ul>
            <p><strong>Items:</strong></p>
            ${imagesHTML}  <!-- Images displayed inline here -->
        `,
    };

    await transporter.sendMail(mailOptions);
};

module.exports = sendQuotationEmail;
