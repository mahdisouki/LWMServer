const nodemailer = require('nodemailer');

const sendPaymentEmail = async ({ customerEmail, taskId, stripeLink, paypalLink, totalPrice, initialPrice, breakdown, taskDetails }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    const breakdownHtml = breakdown
        .map(item => `<li>${item.description}: £${item.amount}</li>`)
        .join("");

    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `Payment Links for Task #${taskId}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; text-align: center;">
            <img src="cid:logo" alt="London Waste Management" style="width: 150px; margin-bottom: 20px;">
            <h2 style="color: #4CAF50;">Complete Your Payment</h2>
            <p style="font-size: 16px;">Initial price: <strong>£${(initialPrice / 100).toFixed(2)}</strong></p>
            <p style="font-size: 16px;">Your final payment amount is <strong>£${(totalPrice / 100).toFixed(2)}</strong>.</p>
            <h3>Task Details:</h3>
            <ul style="text-align: left;">
                <li><strong>Date:</strong> ${taskDetails.date}</li>
                <li><strong>Objects Position:</strong> ${taskDetails.Objectsposition}</li>
                <li><strong>Available Time Slot:</strong> ${taskDetails.available}</li>
            </ul>
            <h3>Price Breakdown:</h3>
            <ul style="text-align: left;">
                ${breakdownHtml}
            </ul>
            <p>Please use one of the links below to complete your payment:</p>
            <div style="margin: 20px 0;">
                <a href="${stripeLink}" style="background-color: #6772e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-right: 10px;">Pay with Stripe</a>
                <a href="${paypalLink}" style="background-color: #ffc439; color: black; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Pay with PayPal</a>
            </div>
            <p style="font-size: 14px; color: #888;">If you have any questions, feel free to contact us.</p>
        </div>
    `,
        attachments: [
            {
                filename: 'Green-Log.png',
                path: 'D:\\Users\\eya20\\LondonWaste\\LWMServer\\logo\\Green-Log.png',                
                cid: 'logo',
            },
        ],
    };

    await transporter.sendMail(mailOptions);
};

module.exports = sendPaymentEmail;
