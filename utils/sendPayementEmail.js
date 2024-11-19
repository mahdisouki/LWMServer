const nodemailer = require('nodemailer');

const sendPaymentEmail = async ({ customerEmail, taskId, stripeLink, paypalLink, totalPrice }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `Payment Links for Task #${taskId}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; text-align: center;">
                <img src="cid:logo" alt="London Waste Management" style="width: 150px; margin-bottom: 20px;">
                <h2 style="color: #4CAF50;">Complete Your Payment</h2>
                <p style="font-size: 16px;">Your payment amount is <strong>£${(totalPrice / 100).toFixed(2)}</strong>.</p>
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
                path: 'D:\\Users\\eya20\\LondonWaste\\LWMServer\\logo\\Green-Log.png',                cid: 'logo',
            },
        ],
    };

    await transporter.sendMail(mailOptions);
};
module.exports =sendPaymentEmail;