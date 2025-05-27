const nodemailer = require('nodemailer');
const path = require('path');

const VAT_RATE = 0.2; // 20% VAT

const sendPaymentEmail = async ({ customerEmail, taskId, stripeLink, paypalLink, totalPrice, breakdown, taskDetails, paymentType, amountToPay, totall }) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    });

    // Extract VAT and build item rows
    const vatRow = breakdown.find(item => item.description === "VAT (20%)");
    const vatAmount = vatRow ? parseFloat(vatRow.amount) : 0;
    const subtotal = totalPrice - vatAmount;
    console.log("totalPrice", totalPrice , "vatAmount", vatAmount, "subtotal", subtotal , "amountToPay", amountToPay , "paymentType", paymentType)
    // Get paid so far (for partial payments)
    const paidSoFar = taskDetails.paidAmount?.amount || 0;
    let remainingBalance;
    if (paymentType === 'deposit') {
        remainingBalance = totall - amountToPay;
    } else if (paymentType === 'remaining' || paymentType === 'total') {
        remainingBalance = 0;
    } else {
        remainingBalance = totall - amountToPay;
    }
    if (remainingBalance < 0) remainingBalance = 0;

    // Build the table rows for items (add position)
    const itemRows = breakdown
      .filter(item => item.itemDescription)
      .map(item => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd;">${item.itemDescription}${item.Objectsposition ? ` (${item.Objectsposition})` : ''}</td>
          <td style="padding:8px;border:1px solid #ddd;">${item.quantity || 1}</td>
          <td style="padding:8px;border:1px solid #ddd;">£${parseFloat(item.price).toFixed(2)}</td>
        </tr>
      `).join("");

    // Get payment type description
    const getPaymentTypeDescription = (type) => {
        switch(type) {
            case 'deposit': return 'Deposit Payment';
            case 'remaining': return 'Remaining Balance Payment';
            case 'total': return 'Full Payment';
            default: return 'Payment';
        }
    };

    // Table HTML (always show full total price)
    const tableHtml = `
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;background:#f4f4f4;">Product</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f4f4f4;">Quantity</th>
            <th style="padding:8px;border:1px solid #ddd;background:#f4f4f4;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr>
            <td colspan="2" style="padding:8px;border:1px solid #ddd;text-align:right;"><strong>Subtotal</strong></td>
            <td style="padding:8px;border:1px solid #ddd;">£${subtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:8px;border:1px solid #ddd;text-align:right;"><strong>VAT (20%)</strong></td>
            <td style="padding:8px;border:1px solid #ddd;">£${vatAmount.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:8px;border:1px solid #ddd;text-align:right;"><strong>Total</strong></td>
            <td style="padding:8px;border:1px solid #ddd;"><strong>£${Number(totall).toFixed(2)}</strong></td>
          </tr>
        </tbody>
      </table>
    `;

    // Payment summary for partial payments
    let paymentSummaryHtml = '';
    if (paymentType === 'deposit' || paymentType === 'remaining') {
        paymentSummaryHtml = `
          <div style="margin: 20px 0; padding: 10px; background: #f9f9f9; border: 1px solid #eee; border-radius: 4px;">
            <p style="font-size: 18px; margin: 0 0 5px 0;"><strong>Amount Due Now:</strong> £${Number(amountToPay).toFixed(2)}</p>
            <p style="font-size: 16px; color: #888; margin: 0;"><strong>Remaining Balance After Payment:</strong> £${remainingBalance.toFixed(2)}</p>
          </div>
        `;
    } else {
        paymentSummaryHtml = `<p style="font-size: 18px;"><strong>Amount Due:</strong> £${Number(amountToPay).toFixed(2)}</p>`;
    }

    const mailOptions = {
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `${getPaymentTypeDescription(paymentType)} Request for Task #${taskDetails.orderNumber}`,
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd;">
            <div style="text-align: center; margin-bottom: 20px;">
                <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management" style="display:block;margin:auto;"/>
            </div>
            <h2 style="background-color: #4CAF50; color: white; text-align: center; padding: 10px 0;">${getPaymentTypeDescription(paymentType)} Request</h2>
            ${paymentSummaryHtml}
            <p style="font-size: 16px; color: grey;">Includes VAT (20%): £${vatAmount.toFixed(2)}</p>
            <h3 style="text-align: left;">Task Details:</h3>
            <ul style="padding-left: 20px; text-align: left;">
                <li><strong>Date:</strong> ${new Date(taskDetails.date).toLocaleDateString()}</li>
                <li><strong>Available Time Slot:</strong> ${taskDetails.available}</li>
                <li><strong>Additional Notes:</strong> ${taskDetails.additionalNotes || "N/A"}</li>
            </ul>
            <h3 style="text-align: left;">Price Breakdown:</h3>
            ${tableHtml}
            <p style="text-align: center;">Please use one of the links below to complete your payment:</p>
            <div style="text-align: center; margin: 20px 0;">
                <a href="${stripeLink}" style="background-color: #6772e5; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">Pay with Stripe</a>
                <a href="${paypalLink}" style="background-color: #0070ba; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px;">Pay with PayPal</a>
            </div>
            <p style="font-size: 14px; color: #888; text-align: center;">If you have any questions, feel free to contact us.</p>
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; font-size: 12px; color: #666;">
                <p>London Waste Management | hello@londonwastemanagement.com | 02030971517</p>
            </div>
        </div>
    `,
        attachments: [
            {
                filename: 'Green-Log.png',
                path: path.join(__dirname, '../logo/Green-Log.png'),
                cid: 'logo',
            },
        ],
    };

    await transporter.sendMail(mailOptions);
    console.log(`Payment request email sent to ${customerEmail}`);
};

module.exports = sendPaymentEmail;

