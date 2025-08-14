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
  console.log("taskDetails", taskDetails, "totalPrice", totalPrice, "vatAmount", vatAmount, "subtotal", subtotal, "amountToPay", amountToPay, "paymentType", paymentType)
  // Compute remaining based on paid so far plus this payment
  const paidSoFar = taskDetails.paidAmount?.amount || 0;
  const projectedPaid = paidSoFar + (Number(amountToPay) || 0);
  let remainingBalance = Math.max(Number(totall) - projectedPaid, 0);
  if (remainingBalance < 0) remainingBalance = 0;

  // Build the table rows for items (match invoice template)
  const itemRows = breakdown
    .filter(item => item.itemDescription)
    .map(item => {
      // Find the matching task item for discount logic
      const taskItem = (taskDetails.items || []).find(
        t => (t.standardItemId?.itemName || t.object) === item.itemDescription
      );
      let discountedPrice = '';
      let showDiscounted = false;
      if (taskDetails.hasDiscount && taskDetails.discountType === "perItem" && taskItem && taskItem.customPrice) {
        discountedPrice = `£${parseFloat(taskItem.customPrice).toFixed(2)}`;
        showDiscounted = true;
      }
      return `
          <tr>
            <td style="padding:10px 6px;border-bottom:1px solid #eee;">${item.itemDescription}${item.Objectsposition ? ` (${item.Objectsposition})` : ''}</td>
            <td style="padding:10px 6px;text-align:center;border-bottom:1px solid #eee;">${item.quantity || 1}</td>
            <td style="padding:10px 6px;text-align:right;border-bottom:1px solid #eee;">£${parseFloat(item.price).toFixed(2)}</td>
            ${showDiscounted ? `<td style=\"padding:10px 6px;text-align:right;border-bottom:1px solid #eee;\">${discountedPrice}</td>` : (taskDetails.hasDiscount && taskDetails.discountType === "perItem" ? '<td></td>' : '')}
            <td style="padding:10px 6px;text-align:center;border-bottom:1px solid #eee;">${item.Objectsposition || ''}</td>
            <td style="padding:10px 6px;text-align:right;border-bottom:1px solid #eee;">£${parseFloat(item.positionFee || 0).toFixed(2)}</td>
            <td style="padding:10px 6px;text-align:right;border-bottom:1px solid #eee;">£${parseFloat(item.total).toFixed(2)}</td>
          </tr>
        `;
    }).join("");

  // Build the table header (match invoice template)
  let tableHeader = `
      <tr style="background:#8dc044;color:#fff;">
        <th style="padding:12px 6px;border-top-left-radius:12px;">Product</th>
        <th style="padding:12px 6px;">Qty</th>
        <th style="padding:12px 6px;">Price</th>
        ${taskDetails.hasDiscount && taskDetails.discountType === "perItem" ? '<th style=\"padding:12px 6px;\">Discounted Price</th>' : ''}
        <th style="padding:12px 6px;">Object position</th>
        <th style="padding:12px 6px;">Position fee</th>
        <th style="padding:12px 6px;border-top-right-radius:12px;">Total</th>
      </tr>
    `;

  // Table HTML (match invoice template)
  const tableHtml = `
      <table style="width:100%;border-collapse:separate;border-spacing:0 0;border-radius:12px;overflow:hidden;margin:20px 0 10px 0;box-shadow:0 2px 8px #f0f0f0;">
        <thead>
          ${tableHeader}
        </thead>
        <tbody style="background:#fff;">
          ${itemRows}
        </tbody>
      </table>
    `;

  // Payment summary for partial payments (restore)
  let paymentSummaryHtml = '';
  if (paymentType === 'deposit' || paymentType === 'remaining') {
    paymentSummaryHtml = `
          <div style="margin: 0 0 18px 0; padding: 14px 18px; background:rgb(255, 255, 255); border: 1.5px solid #8bc34a; border-radius: 8px;">
            <span style="display:block;font-size:18px;color:#222;"><strong>Amount due Now :</strong> £${Number(amountToPay).toFixed(2)}</span>
            <span style="display:block;font-size:15px;color:#666;margin-top:2px;">Remaining Balance After Payment: £${remainingBalance.toFixed(2)}</span>
          </div>
        `;
  } else {
    paymentSummaryHtml = `<div style="margin: 0 0 18px 0; padding: 14px 18px; background:rgb(255, 255, 255); border: 1.5px solid #8bc34a; border-radius: 8px;"><span style="font-size:18px;"><strong>Amount Due :</strong> £${Number(amountToPay).toFixed(2)}</span></div>`;
  }

  // Discount row for summary (match invoice template)
  let discountRow = '';
  if (taskDetails.hasDiscount && taskDetails.discountType === "percentage" && taskDetails.customDiscountPercent > 0) {
    const discountAmount = ((subtotal * taskDetails.customDiscountPercent) / 100).toFixed(2);
    discountRow = `<div><span>Discount (${taskDetails.customDiscountPercent}%) :</span><span>-£${discountAmount}</span></div>`;
  }

  // Subtotal, VAT, Total summary (match invoice template)
  const summaryBoxHtml = `
      <div style="margin: 18px 0 0 0; float:right; min-width:220px; background:#fafafa; border-radius:12px; border:1px solid #e6e6e6; box-shadow:0 1px 4px #f4f4f4;">
        <table style="width:100%;border-collapse:separate;border-spacing:0 0;">
          <tr>
            <td style="padding:8px 12px;text-align:right;color:#888;">Subtotal :</td>
            <td style="padding:8px 12px;text-align:right;color:#222;">£${subtotal.toFixed(2)}</td>
          </tr>
          ${discountRow ? `<tr><td style=\"padding:8px 12px;text-align:right;color:#888;\">${discountRow}</td><td></td></tr>` : ''}
          <tr>
            <td style="padding:8px 12px;text-align:right;color:#888;">VAT(20%) :</td>
            <td style="padding:8px 12px;text-align:right;color:#222;">£${vatAmount.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;text-align:right;color:#8DC044;font-weight:bold;">Total :</td>
            <td style="padding:8px 12px;text-align:right;color:#8DC044;font-weight:bold;">£${Number(totall).toFixed(2)}</td>
        </tr>
        </table>
      </div>
      <div style="clear:both;"></div>
    `;

  // Get payment type description
  const getPaymentTypeDescription = (type) => {
    switch (type) {
      case 'deposit': return 'Deposit Payment';
      case 'remaining': return 'Remaining Balance Payment';
      case 'total': return 'Full Payment';
      default: return 'Payment';
    }
  };

  // Task details with green icons
  const taskDetailsHtml = `
      <ul style="padding-left: 0; list-style: none; margin: 0 0 18px 0;">
        <li style="margin-bottom: 6px;"><span style="color:#8DC044;font-size:18px;vertical-align:middle;">●</span> <strong>Date :</strong> ${new Date(taskDetails.date).toLocaleDateString('en-GB')}</li>
        <li style="margin-bottom: 6px;"><span style="color:#8DC044;font-size:18px;vertical-align:middle;">●</span> <strong>Available Time Slot:</strong> ${taskDetails.available}</li>
        <li><span style="color:#8DC044;font-size:18px;vertical-align:middle;">●</span> <strong>Additional Notes:</strong> ${taskDetails.additionalNotes || "N/A"}</li>
      </ul>
    `;

  // Buttons (green, rounded, modern)
  const buttonsHtml = `
      <div style="text-align: center; margin: 32px 0 18px 0;">
        <a href="${stripeLink}" style="background: #8DC044; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 17px; font-weight: 600; margin-right: 12px; box-shadow:0 2px 8px #e0f2f1; transition: background 0.2s; display:inline-block; margin:10px; width: 200px; text-align: center;">Pay with Credit Card</a>
        <a href="${paypalLink}" style="border:1px solid #8DC044;background:rgb(255, 255, 255); color: #8DC044; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 17px; font-weight: 600; box-shadow:0 2px 8px #e0f2f1; transition: background 0.2s; display:inline-block; width: 200px; text-align: center;">Pay with Paypal</a>
          </div>
        `;

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: customerEmail,
    subject: `${getPaymentTypeDescription(paymentType)} Request for Task #${taskDetails.orderNumber}`,
    html: `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 32px auto; padding: 0; background-image: url('https://res.cloudinary.com/ddcsuzef0/image/upload/f_auto,q_auto/i9xnzsb0phuzg96ydjff'); background-size: cover; background-position: center; background-repeat: no-repeat; border-radius: 18px; box-shadow: 0 4px 24px #e8f5e9; border: 1.5px solid #e0e0e0;background-color:rgb(255, 255, 255);">
            <div style="background: #ffffff43; border-top-left-radius: 18px; border-top-right-radius: 18px; padding: 32px 32px 18px 32px; border-bottom: 1.5px solid #e0e0e0;">
                <div style="text-align: center; margin-bottom: 18px;">
                    <img src="https://res.cloudinary.com/ddcsuzef0/image/upload/v1751659277/logo_cr9bor.png" width="140" alt="London Waste Management" style="display:block;margin:auto;"/>
                </div>
                <div style="background:rgb(255, 255, 255); padding: 10px 0 0 0; box-shadow: 0 6px 24px 0 rgba(140,192,68,0.18), 0 1.5px 0 #8dc044;">
                  <h2 style="
                    background:rgb(255, 255, 255);
                    color: #8DC044;
                    text-align: center;
                    padding: 18px 0 16px 0;
                    border-bottom-left-radius: 45px;
                    border-bottom-right-radius: 45px;
                    font-size: 28px;
                    font-weight: 800;
                    margin: 0 0 18px 0;
                    letter-spacing: 1px;
                    box-shadow: 0 2px 8px rgb(77, 85, 69);
                    text-transform: uppercase;
                    border-bottom: 2px solid rgb(47, 53, 39);
                  ">
                    ${getPaymentTypeDescription(paymentType)} Request
                  </h2>
                
                ${paymentSummaryHtml}
                <div style="color: #888; font-size: 15px; margin-bottom: 18px;">Includes VAT(20%): £${vatAmount.toFixed(2)}</div>
                <div style="margin-bottom: 18px;">${taskDetailsHtml}</div>
                <div style="margin-bottom: 18px;"> <span style="font-size:18px;font-weight:600;color:#8DC044;">Price Breakdown:</span></div>
                ${tableHtml}
                ${summaryBoxHtml}
                ${buttonsHtml}
                <div style="font-size: 14px; color: #888; text-align: center; margin: 18px 0 0 0;">If you have any questions, feel free to contact us.</div>
                </div>
            </div>
            <div style="margin-top: 0; padding: 18px 0 12px 0; border-top: 1.5px solid #e0e0e0; text-align: center; font-size: 13px; color: #666; background: #f4f4f4; border-bottom-left-radius: 18px; border-bottom-right-radius: 18px;">
                London Waste Management | <a href="mailto:hello@londonwastemanagement.com" style="color:#8DC044;text-decoration:none;">hello@londonwastemanagement.com</a> | 02030971517
            </div>
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

