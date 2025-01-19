const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const sendPaymentConfirmationEmail = async ({
    email,
    firstName,
    lastName,
    orderId,
    paymentDate,
    amount,
    currency,
    paymentType,
    breakdown,
}) => {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Logo Path
    const logoPath = "D:\\Users\\eya20\\LondonWaste\\LWMServer\\logo\\Green-Log.png";
    if (!fs.existsSync(logoPath)) {
        console.error("Logo file not found. Ensure the path is correct.");
        return;
    }

    // PDF Generation
    const pdfFileName = `payment-confirmation-${orderId}.pdf`;
    const pdfPath = path.join(__dirname, "..", "public", pdfFileName);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(fs.createWriteStream(pdfPath));

    // Add Logo to PDF
    doc.rect(0, 0, doc.page.width, 50).fill("#4CAF50");
    doc.image(logoPath, 50, 10, { width: 50 });
    doc.fillColor("#ffffff").fontSize(20).text("Payment Confirmation", 110, 15, { align: "center" });
    doc.moveDown();

    // Add Payment Confirmation Details
    doc.moveDown();
    doc.fillColor("#000000").fontSize(12).text(`Hi ${firstName} ${lastName},`);
    doc.text(`We confirm your payment for Task #${orderId}.`);
    doc.moveDown();

    doc.fontSize(14).fillColor("#4CAF50").text("Payment Details:");
    doc.fillColor("#000000").fontSize(12).text(`Date: ${paymentDate}`);
    doc.text(`Amount Paid: ${currency} £${amount.toFixed(2)} (includes VAT)`);
    doc.text(`Payment Method: ${paymentType}`);
    doc.moveDown();

    // Add Breakdown of Items
    doc.fontSize(14).fillColor("#4CAF50").text("Task Items:");
    breakdown.forEach((item) => {
        doc.fontSize(12).fillColor("#000000").text(
            `${item.itemDescription || item.description}: £${item.price || item.amount} (Quantity: ${
                item.quantity || 1
            })`
        );
    });

    doc.moveDown();
    doc.fontSize(12).fillColor("#000000").text("Thank you for choosing London Waste Management!");
    doc.moveDown();
    doc.fontSize(10).fillColor("#888888").text("London Waste Management", { align: "center" });
    doc.end();

    // Public Download Link
    const downloadLink = `https://7026-197-0-13-187.ngrok-free.app/public/${pdfFileName}`;

    // Email Content with inline logo
    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Payment Confirmation for Task #${orderId}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; line-height: 1.6;">
            <div style="text-align: center; background-color: #4CAF50; padding: 10px;">
                <img src="cid:logo" alt="London Waste Management" style="width: 120px; margin-bottom: 10px;">
                <h2 style="color: white;">Thank you for your order</h2>
            </div>
            <p>Hi ${firstName} ${lastName},</p>
            <p>We’ve received payment for your task #${orderId}, and all the details are confirmed below:</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Product</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: center;">Quantity</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Price</th>
                    </tr>
                </thead>
                <tbody>
                    ${breakdown
                        .map(
                            (item) => `
                        <tr>
                            <td style="border: 1px solid #ddd; padding: 8px;">${item.itemDescription || item.description}</td>
                            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.quantity || 1}</td>
                            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">£${item.price || item.amount}</td>
                        </tr>`
                        )
                        .join("")}
                </tbody>
            </table>
            <p><strong>Total Paid:</strong> £${amount.toFixed(2)} ${currency}</p>
            <p><strong>Payment Date:</strong> ${paymentDate}</p>
            <p><strong>Payment Method:</strong> ${paymentType}</p>
            <p>Download your receipt here: <a href="${downloadLink}" target="_blank">Download Receipt</a></p>
            <p>Thank you for choosing London Waste Management!</p>
        </div>
        `,
        attachments: [
            {
                filename: "Green-Log.png",
                path: logoPath,
                cid: "logo", // same cid as in the email HTML
            },
        ],
    };

    await transporter.sendMail(mailOptions);
    console.log(`Payment confirmation email with download link sent to ${email}`);
};

module.exports = sendPaymentConfirmationEmail;
