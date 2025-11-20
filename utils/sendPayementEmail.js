const nodemailer = require('nodemailer');

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

  // Calculate subtotal from the full task total (totall), not the partial payment (totalPrice)
  const subtotal = Number(totall) - vatAmount;

  console.log("taskDetails", taskDetails, "totalPrice (partial payment)", totalPrice, "totall (full task total)", totall, "vatAmount", vatAmount, "subtotal", subtotal, "amountToPay", amountToPay, "paymentType", paymentType)

  // Compute remaining based on paid so far plus this payment
  // For deposit payments, we need to check if the paidAmount is already set to the deposit amount
  // If so, we should use 0 as the base since this payment hasn't been made yet
  let paidSoFar = taskDetails.paidAmount?.amount || 0;

  // If this is a deposit payment and the paidAmount equals the amountToPay, 
  // it means the deposit amount was just set but not actually paid yet
  if (paymentType === 'deposit' && paidSoFar === Number(amountToPay)) {
    paidSoFar = 0; // Reset to 0 since this payment hasn't been made yet
  }

  const projectedPaid = paidSoFar + (Number(amountToPay) || 0);
  let remainingBalance = Math.max(Number(totall) - projectedPaid, 0);
  if (remainingBalance < 0) remainingBalance = 0;

  // Build simplified table rows for Task Details (Product, Qty, Price only)
  const taskDetailsItemRows = breakdown
    .filter(item => item.itemDescription)
    .map(item => {
      // Find the matching task item for discount logic
      const taskItem = (taskDetails.items || []).find(
        t => (t.standardItemId?.itemName || t.object) === item.itemDescription
      );

      // Get price to display
      let displayPrice = parseFloat(item.price);

      if (taskDetails.hasDiscount && taskDetails.discountType === "perItem" && taskItem && taskItem.customPrice) {
        // Show discounted price
        displayPrice = parseFloat(taskItem.customPrice);
      }

      return `
          <tr>
            <td style="padding:10px; border-top:1px solid #e5e7eb;">${item.itemDescription}</td>
            <td style="padding:10px; border-top:1px solid #e5e7eb;">${item.quantity || 1}</td>
            <td style="padding:10px; border-top:1px solid #e5e7eb;">£${displayPrice.toFixed(2)}</td>
          </tr>
        `;
    }).join("");

  // Get payment type description
  const getPaymentTypeDescription = (type) => {
    switch (type) {
      case 'deposit': return 'Deposit Payment Request';
      case 'remaining': return 'Remaining Balance Payment Request';
      case 'total': return 'Full Payment Request';
      default: return 'Payment Request';
    }
  };

  // Format date
  const formattedDate = new Date(taskDetails.date).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Discount row for summary
  let discountRow = '';
  if (taskDetails.hasDiscount && taskDetails.discountType === "percentage" && taskDetails.customDiscountPercent > 0) {
    const discountAmount = ((subtotal * taskDetails.customDiscountPercent) / 100).toFixed(2);
    discountRow = `
            <p style="margin:0 0 8px; font-size:13px;">
              Discount (${taskDetails.customDiscountPercent}%)
              <span style="float:right; font-weight:bold;">-£${discountAmount}</span>
            </p>
          `;
  }

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: customerEmail,
    subject: `${getPaymentTypeDescription(paymentType)}`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    @media only screen and (max-width: 620px) {
      .main-table { width: 100% !important; }
      .stack { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }
      .inner { padding: 0 12px !important; }
      .center-mobile { text-align:center !important; }
      .payment-button { margin-bottom: 8px !important; margin-right: 0 !important; }
      .green-box { margin-top: 12px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
    <tr>
      <td align="center" style="padding:24px 12px 32px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" class="main-table"
          style="border-collapse:collapse; max-width:600px; background:#ffffff; box-shadow:0 15px 38px rgba(0,0,0,0.20);">
          <tr>
            <td style="padding:0; line-height:0;">
              <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1763549850/Group_1261156226_hfpvko.png"
                width="600"
                style="display:block; width:100%; height:auto; border:0; margin:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:18px;" class="inner">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 6px 20px rgba(0,0,0,0.08);">
                <tr>
                  <td align="center" style="padding:20px 16px 6px;">
                    <p style="margin:0; font-size:22px; font-weight:bold; color:#111827; text-transform:uppercase;">
                      ${getPaymentTypeDescription(paymentType)}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom:14px;">
                    <div style="width:85px; height:3px; background:#34C759;"></div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0"
                      style="border-collapse:collapse; border:1px solid #e5e7eb;">
                      <tr>
                        <td class="stack" style="padding:12px; border-right:1px solid #e5e7eb;">
                          <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Amount Due Now</p>
                          <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${Number(amountToPay).toFixed(2)}</p>
                        </td>
                        <td class="stack" style="padding:12px; border-right:1px solid #e5e7eb;">
                          <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Remaining Balance</p>
                          <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${paymentType === 'total' ? '0.00' : remainingBalance.toFixed(2)}</p>
                        </td>
                        <td class="stack" style="padding:12px;">
                          <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Includes VAT</p>
                          <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${vatAmount.toFixed(2)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 16px;">
                    <p style="margin:0; font-size:14px; font-weight:bold; color:#111827; text-transform:uppercase;">Task Details</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 16px 18px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Product</th>
                        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Qty</th>
                        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Price</th>
                      </tr>
                      ${taskDetailsItemRows}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 16px;">
                    <p style="margin:0; font-size:14px; font-weight:bold; color:#111827; text-transform:uppercase;">Price Breakdown</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 16px 18px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td class="stack" width="50%" style="padding-right:8px;">
                          <div style="background:#f9fafb; padding:10px; margin-bottom:6px;">
                            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Date</p>
                            <p style="margin:0; font-size:13px; color:#111827;">${formattedDate}</p>
                          </div>
                          <div style="background:#f9fafb; padding:10px; margin-bottom:6px;">
                            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Time Slot</p>
                            <p style="margin:0; font-size:13px; color:#111827;">${taskDetails.available || "N/A"}</p>
                          </div>
                          <div style="background:#f9fafb; padding:10px;">
                            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Notes</p>
                            <p style="margin:0; font-size:13px; color:#111827;">${taskDetails.additionalNotes || "N/A"}</p>
                          </div>
                        </td>
                        <td class="stack green-box" width="50%" style="padding-left:8px;">
                          <div style="background:#34C759; padding:14px; color:#ffffff;">
                            <p style="margin:0 0 6px; font-size:13px;">
                              Subtotal
                              <span style="float:right; font-weight:bold;">£${subtotal.toFixed(2)}</span>
                            </p>
                            ${discountRow}
                            <p style="margin:0 0 8px; font-size:13px;">
                              VAT
                              <span style="float:right; font-weight:bold;">£${vatAmount.toFixed(2)}</span>
                            </p>
                            <p style="margin:8px 0 0; font-size:12px; text-transform:uppercase;">Invoice Total</p>
                            <p style="margin:0; font-size:22px; font-weight:bold; color:#ffffff;">£${Number(totall).toFixed(2)}</p>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 16px;">
                    <p style="margin:0; font-size:13px; color:#4b5563;">Choose a payment method below:</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:12px 16px 18px;">
                    <a href="${stripeLink}" class="payment-button"
                      style="background:#635BFF; color:#ffffff; padding:10px 18px; font-size:13px; text-decoration:none; text-transform:uppercase; margin-right:6px; display:inline-block;">
                      Pay with Stripe
                    </a>
                    <a href="${paypalLink}" class="payment-button"
                      style="background:#003087; color:#ffffff; padding:10px 18px; font-size:13px; text-decoration:none; text-transform:uppercase; display:inline-block;">
                      Pay with PayPal
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="border-top:1px solid #e5e7eb; padding:10px 16px 14px;">
                    <p style="margin:0; font-size:11px; color:#6b7280;">
                      London Waste Management |
                      <a href="mailto:hello@londonwastemanagement.com" style="color:#34C759; text-decoration:none;">
                        hello@londonwastemanagement.com
                      </a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };

  await transporter.sendMail(mailOptions);
  console.log(`Payment request email sent to ${customerEmail}`);
};

module.exports = sendPaymentEmail;

