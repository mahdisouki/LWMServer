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

    const pdfFileName = `payment-confirmation-${orderId}.pdf`;
    const pdfPath = path.join(__dirname, "..", "public", pdfFileName);// Change public folder path

    // **Création du PDF**
    const doc = new PDFDocument();
    doc.pipe(fs.createWriteStream(pdfPath));
    doc.fontSize(20).text("Payment Confirmation", { align: "center" });
    doc.moveDown().fontSize(12).text(`Dear ${firstName} ${lastName},`);
    doc.text(`We confirm your payment for Task #${orderId}.`);
    doc.moveDown().text("Payment Details:");
    doc.text(`Date: ${paymentDate}`);
    doc.text(`Amount Paid: ${currency} £${amount.toFixed(2)} (includes VAT)`);
    doc.text(`Payment Method: ${paymentType}`);
    doc.moveDown().text("Task Items:");
    breakdown.forEach((item) => {
        doc.text(
            `${item.itemDescription || item.description}: £${item.price || item.amount} (Quantity: ${item.quantity || 1})`
        );
    });
    doc.moveDown().text("Thank you for choosing London Waste Management!");
    doc.end();

    // **Lien de téléchargement public**
    const downloadLink = `https://dc2f-102-156-43-63.ngrok-free.app/public/${pdfFileName}`;

    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Payment Confirmation for Task #${orderId}`,
        html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; line-height: 1.6;">
          <h2 style="background-color: #4CAF50; color: white; text-align: center; padding: 10px;">Payment Confirmation</h2>
          <p>Dear ${firstName} ${lastName},</p>
          <p>We confirm your payment for Task #${orderId}.</p>
          <p><strong>Payment Details:</strong></p>
          <ul>
              <li><strong>Date:</strong> ${paymentDate}</li>
              <li><strong>Amount Paid:</strong> ${currency} £${amount.toFixed(2)} (includes VAT)</li>
              <li><strong>Payment Method:</strong> ${paymentType}</li>
          </ul>
          <h3>Task Items:</h3>
          <ul>
              ${breakdown
                  .map(
                      (item) =>
                          `<li>${item.itemDescription || item.description}: £${item.price || item.amount} (Quantity: ${item.quantity || 1})</li>`
                  )
                  .join("")}
          </ul>
          <p>
            <strong>Download Receipt:</strong> 
            <a href="${downloadLink}" target="_blank" download>Click to download PDF</a>
          </p>
          <p>Thank you for choosing London Waste Management!</p>
      </div>
  `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Payment confirmation email with download link sent to ${email}`);
};

module.exports = sendPaymentConfirmationEmail;
