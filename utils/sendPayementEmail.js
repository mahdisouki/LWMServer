const nodemailer = require('nodemailer');

const VAT_RATE = 0.2; // 20% TVA

const sendPaymentEmail = async ({ customerEmail, taskId, stripeLink, paypalLink, totalPrice, breakdown, taskDetails }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Récupérer la TVA directement depuis le breakdown
    const vatEntry = breakdown.find(item => item.description === "VAT (20%)");
    const vatAmount = vatEntry ? vatEntry.amount : "0.00";

    const breakdownHtml = breakdown
        .map(item => `
        <li style="margin-bottom: 8px; font-size: 16px;">
            ${item.itemDescription ? `<strong>${item.itemDescription}:</strong> £${item.price}` : `<em>${item.description}:</em> £${item.amount}`}
            ${item.Objectsposition ? `(Position: ${item.Objectsposition})` : ""}
        </li>`)
        .join("");

    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `Payment Request for Task #${taskId}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd;">
            <h2 style="background-color: #4CAF50; color: white; text-align: center; padding: 10px 0;">Payment Request</h2>
            <p style="font-size: 18px;"><strong>Final Price:</strong> £${(totalPrice / 100).toFixed(2)}</p>
            <p style="font-size: 16px; color: grey;">Includes VAT (20%): £${vatAmount}</p>
            <h3 style="text-align: left;">Task Details:</h3>
            <ul style="padding-left: 20px; text-align: left;">
                <li><strong>Date:</strong> ${new Date(taskDetails.date).toLocaleDateString()}</li>
                <li><strong>Available Time Slot:</strong> ${taskDetails.available}</li>
                <li><strong>Additional Notes:</strong> ${taskDetails.additionalNotes || "N/A"}</li>
            </ul>
            <h3 style="text-align: left;">Price Breakdown:</h3>
            <ul style="padding-left: 20px; text-align: left;">${breakdownHtml}</ul>
            <p style="text-align: center;">Please use one of the links below to complete your payment:</p>
            <div style="text-align: center; margin: 20px 0;">
                <a href="${stripeLink}" style="background-color: #6772e5; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">Pay with Stripe</a>
                <a href="${paypalLink}" style="background-color: #ffc439; color: black; padding: 12px 20px; text-decoration: none; border-radius: 5px;">Pay with PayPal</a>
            </div>
            <p style="font-size: 14px; color: #888; text-align: center;">If you have any questions, feel free to contact us.</p>
        </div>
    `,
        attachments: [
            {
                filename: 'Green-Log.png',
                path: 'C:\\Users\\souki\\OneDrive\\Documents\\GitHub\\LWMServer\\logo\\Green-Log.png',
                cid: 'logo',
            },
        ],
    };

    await transporter.sendMail(mailOptions);
    console.log(`Payment request email sent to ${customerEmail}`);
};


module.exports = sendPaymentEmail;

