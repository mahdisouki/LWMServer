const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');

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

  // Calculate subtotal BEFORE discounts from items (original prices)
  let subtotalBeforeDiscounts = 0;
  if (taskDetails.items && taskDetails.items.length > 0) {
    taskDetails.items.forEach((item) => {
      // For custom items, use item.price; for standard items, use standardItemId.price
      const itemPrice = item.standardItemId
        ? (item.standardItemId.price * item.quantity || 0)
        : (item.price * item.quantity || 0);

      const positionPricePerUnit =
        item.Objectsposition === 'InsideWithDismantling'
          ? (item.standardItemId?.insideWithDismantlingPrice || 0)
          : item.Objectsposition === 'Inside'
            ? (item.standardItemId?.insidePrice || 0)
            : 0;

      const positionPrice = positionPricePerUnit * (item.quantity || 1);
      const itemSubtotal = itemPrice + positionPrice;
      subtotalBeforeDiscounts += itemSubtotal;
    });
  }

  // Calculate subtotal AFTER discounts (this is what totall - vatAmount gives us)
  const subtotalAfterDiscounts = Number(totall) - vatAmount;

  console.log("taskDetails", taskDetails, "totalPrice (partial payment)", totalPrice, "totall (full task total)", totall, "vatAmount", vatAmount, "subtotalBeforeDiscounts", subtotalBeforeDiscounts, "subtotalAfterDiscounts", subtotalAfterDiscounts, "amountToPay", amountToPay, "paymentType", paymentType)

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

  // Build the table rows for items (with all original logic for discounts and position fees)
  const itemRows = breakdown
    .filter(item => item.itemDescription)
    .map(item => {
      // Find the matching task item for discount logic
      const taskItem = (taskDetails.items || []).find(
        t => (t.standardItemId?.itemName || t.object) === item.itemDescription
      );

      // Determine if we should show discounted price column
      const showDiscounted = taskDetails.hasDiscount && taskDetails.discountType === "perItem";

      // Get original price (before discount) and discounted price
      let originalPrice = parseFloat(item.price);
      let discountedPrice = '';

      if (showDiscounted && taskItem && taskItem.customPrice) {
        // Show the custom price as discounted price
        discountedPrice = `£${parseFloat(taskItem.customPrice).toFixed(2)}`;

        // For standard items, get original price from standardItemId.price
        // For custom items, get original price from taskItem.price
        if (taskItem.standardItemId) {
          // Standard item - get original price from standard item
          originalPrice = parseFloat(taskItem.standardItemId.price);
        } else {
          // Custom item - get original price from taskItem.price
          originalPrice = parseFloat(taskItem.price);
        }
      } else {
        // No discount, so the price shown is the original price
        discountedPrice = `£${originalPrice.toFixed(2)}`;
      }

      // Calculate position fee per unit (for display only - total column already includes quantity)
      const positionFeePerUnit = !item.standardItemId ? 0 :
        item.Objectsposition === "Outside" ? 0 :
          item.Objectsposition === "InsideWithDismantling" ? parseFloat(item.insideWithDismantlingPrice || 0) :
            item.Objectsposition === "Inside" ? parseFloat(item.insidePrice || 0) :
              0;
      const positionFee = positionFeePerUnit.toFixed(2);

      return `
          <tr>
            <td style="padding:10px; border-top:1px solid #e5e7eb;">${item.itemDescription}</td>
            <td style="padding:10px; border-top:1px solid #e5e7eb; text-align:center;">${item.quantity || 1}</td>
            <td style="padding:10px; border-top:1px solid #e5e7eb; text-align:right;">£${originalPrice.toFixed(2)}</td>
            ${showDiscounted ? `<td style="padding:10px; border-top:1px solid #e5e7eb; text-align:right;">${discountedPrice || '£' + originalPrice.toFixed(2)}</td>` : ''}
            <td style="padding:10px; border-top:1px solid #e5e7eb; text-align:center;">${item.Objectsposition || ''}</td>
            <td style="padding:10px; border-top:1px solid #e5e7eb; text-align:right;">£${positionFee}</td>
            <td style="padding:10px; border-top:1px solid #e5e7eb; text-align:right;">£${parseFloat(item.total).toFixed(2)}</td>
          </tr>
        `;
    }).join("");

  // Build the table header with conditional discount column
  const showDiscountedColumn = taskDetails.hasDiscount && taskDetails.discountType === "perItem";
  const tableHeader = `
      <tr>
        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Product</th>
        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Qty</th>
        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Price</th>
        ${showDiscountedColumn ? '<th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Discounted Price</th>' : ''}
        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Object position</th>
        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Position fee</th>
        <th align="left" style="background:#f3f4f6; padding:8px; font-size:11px; color:#6b7280; text-transform:uppercase;">Total</th>
      </tr>
    `;

  // Task details HTML for price breakdown section
  const taskDetailsHtml = `
      <div style="background:#f9fafb; padding:10px; margin-bottom:6px;">
        <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Date</p>
        <p style="margin:0; font-size:13px; color:#111827;">${new Date(taskDetails.date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>
      <div style="background:#f9fafb; padding:10px; margin-bottom:6px;">
        <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Time Slot</p>
        <p style="margin:0; font-size:13px; color:#111827;">${taskDetails.available === 'AnyTime' ? 'Any time (6:30am to 8:30pm)' :
      taskDetails.available === '7am-12pm' ? '07:00 - 12:00' :
        taskDetails.available === '12pm-5pm' ? '12:00 - 17:00' : taskDetails.available}</p>
      </div>
      <div style="background:#f9fafb; padding:10px;">
        <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Notes</p>
        <p style="margin:0; font-size:13px; color:#111827;">${taskDetails.additionalNotes || "N/A"}</p>
      </div>
    `;

  // Calculate item discount total for per-item discounts
  let itemDiscountTotal = 0;
  if (taskDetails.hasDiscount && taskDetails.discountType === "perItem" && taskDetails.items) {
    taskDetails.items.forEach((item) => {
      if (item.customPrice) {
        const originalItemPrice = item.standardItemId
          ? Number(item.standardItemId.price)
          : Number(item.price);
        const customPrice = Number(item.customPrice);
        const quantity = Number(item.quantity) || 1;
        itemDiscountTotal += (originalItemPrice - customPrice) * quantity;
      }
    });
  }

  // Calculate 10% automatic discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
  const isAvailableAnyTime = taskDetails.available === 'AnyTime';
  const isCreatedByPublic = taskDetails.createdByType === 'public';
  const hasItems = taskDetails.items && taskDetails.items.length > 0;
  const allItemsOutside = hasItems && taskDetails.items.every((i) => i.Objectsposition === 'Outside');

  let automaticDiscount10Percent = 0;
  if (isAvailableAnyTime && isCreatedByPublic && hasItems && allItemsOutside) {
    console.log('✅ Applying 10% discount for Outside items with AnyTime and public type in payment email');
    automaticDiscount10Percent = subtotalBeforeDiscounts * 0.1;
  }

  // Discount row for summary
  let discountRowHtml = '';
  let calculatedDiscountAmount = 0;
  if (taskDetails.hasDiscount) {
    let discountAmount = 0;
    let discountLabel = '';

    if (taskDetails.discountType === "percentage" && taskDetails.customDiscountPercent > 0) {
      // Calculate discount from subtotal BEFORE discounts
      discountAmount = (subtotalBeforeDiscounts * taskDetails.customDiscountPercent) / 100;
      discountLabel = `Discount (${taskDetails.customDiscountPercent}%)`;
    } else if (taskDetails.discountType === "perItem" && itemDiscountTotal > 0) {
      discountAmount = itemDiscountTotal;
      discountLabel = 'Item Discounts';
    }

    calculatedDiscountAmount = discountAmount;

    if (discountAmount > 0) {
      discountRowHtml = `<p style="margin:0 0 8px; font-size:13px;">${discountLabel}<span style="float:right; font-weight:bold;">-£${discountAmount.toFixed(2)}</span></p>`;
    }
  }

  // Display automatic 10% discount before other discounts if it exists
  if (automaticDiscount10Percent > 0) {
    const automaticDiscountHtml = `<p style="margin:0 0 8px; font-size:13px;">Discount (10%)<span style="float:right; font-weight:bold;">-£${automaticDiscount10Percent.toFixed(2)}</span></p>`;
    // Prepend automatic discount to existing discount row
    discountRowHtml = automaticDiscountHtml + discountRowHtml;
  }

  // Display coupon discount if exists (do not re‑validate here; we trust the coupon
  // already applied when calculating the task's total so the email always matches it)
  let couponDiscountHtml = '';
  let couponDiscountAmount = 0;
  if (taskDetails.couponCode) {
    try {
      const Coupon = require('../models/Coupon');
      const normalizedCouponCode = String(taskDetails.couponCode).trim().toUpperCase();
      const coupon = await Coupon.findOne({ code: normalizedCouponCode });
      if (coupon) {
        const subtotalAfterDiscounts = subtotalBeforeDiscounts - automaticDiscount10Percent - calculatedDiscountAmount;
        let couponDiscount = 0;
        let couponLabel = '';

        if (coupon.type === 'custom') {
          if (coupon.discountType === 'percentage') {
            couponDiscount = (subtotalAfterDiscounts * coupon.discountValue) / 100;
            couponLabel = `Coupon Discount (${coupon.code} - ${coupon.discountValue}%)`;
          } else if (coupon.discountType === 'amount') {
            couponDiscount = coupon.discountValue;
            couponLabel = `Coupon Discount (${coupon.code} - £${coupon.discountValue.toFixed(2)})`;
          }
        } else {
          // Random coupon – treat as percentage on subtotal after other discounts
          couponDiscount = (subtotalAfterDiscounts * coupon.percentage) / 100;
          couponLabel = `Coupon Discount (${coupon.code} - ${coupon.percentage}%)`;
        }

        couponDiscountAmount = couponDiscount;
        couponDiscountHtml = `<p style="margin:0 0 8px; font-size:13px;">${couponLabel}<span style="float:right; font-weight:bold;">-£${couponDiscount.toFixed(2)}</span></p>`;
      }
    } catch (error) {
      console.error('Error fetching coupon for payment email:', error);
    }
  }

  // Use subtotal BEFORE discounts for display
  const subtotalForDisplay = subtotalBeforeDiscounts;

  // Calculate subtotal after all discounts to check for callout fee
  let subtotalAfterAllDiscounts = subtotalBeforeDiscounts;
  if (automaticDiscount10Percent > 0) {
    subtotalAfterAllDiscounts -= automaticDiscount10Percent;
  }
  if (calculatedDiscountAmount > 0) {
    subtotalAfterAllDiscounts -= calculatedDiscountAmount;
  }
  if (couponDiscountAmount > 0) {
    subtotalAfterAllDiscounts -= couponDiscountAmount;
  }

  // Calculate callout fee
  const MIN_BASE_AMOUNT = 37.5; // Minimum fee (before VAT)
  let callOutFee = 0;
  let showCallOutFeeRow = false;
  const enforceMinimumPrice = taskDetails.createdByType !== 'Admin' || taskDetails.applyMinFee === true;
  
  if (enforceMinimumPrice && subtotalAfterAllDiscounts < MIN_BASE_AMOUNT) {
    callOutFee = MIN_BASE_AMOUNT - subtotalAfterAllDiscounts;
    showCallOutFeeRow = true;
  }

  // Build callout fee row HTML
  let callOutFeeRowHtml = '';
  if (showCallOutFeeRow && callOutFee > 0) {
    callOutFeeRowHtml = `<p style="margin:0 0 8px; font-size:13px;">Call out fee<span style="float:right; font-weight:bold;">£${callOutFee.toFixed(2)}</span></p>`;
  }

  // Invoice summary box (right side of price breakdown)
  const summaryBoxHtml = `
      <div style="background:#34C759; padding:14px; color:#ffffff;">
        <p style="margin:0 0 6px; font-size:13px;">
          Subtotal
          <span style="float:right; font-weight:bold;">£${subtotalForDisplay.toFixed(2)}</span>
        </p>
        ${discountRowHtml}
        ${couponDiscountHtml}
        ${callOutFeeRowHtml}
        <p style="margin:0 0 8px; font-size:13px;">
          VAT
          <span style="float:right; font-weight:bold;">£${vatAmount.toFixed(2)}</span>
        </p>
        <p style="margin:8px 0 0; font-size:13px; text-transform:uppercase;">
          Invoice Total
          <span style="float:right; font-weight:bold; font-size:22px;">£${Number(totall).toFixed(2)}</span>
        </p>
      </div>
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

  // Payment summary table (Amount Due Now, Remaining Balance, Includes VAT)
  let paymentSummaryTable = '';
  if (paymentType === 'deposit' || paymentType === 'remaining') {
    paymentSummaryTable = `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; border:1px solid #e5e7eb;">
        <tr>
          <td class="payment-summary-cell" style="padding:12px; border-right:1px solid #e5e7eb;">
            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Amount Due Now</p>
            <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${Number(amountToPay).toFixed(2)}</p>
          </td>
          <td class="payment-summary-cell" style="padding:12px; border-right:1px solid #e5e7eb;">
            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Remaining Balance</p>
            <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${remainingBalance.toFixed(2)}</p>
          </td>
          <td class="payment-summary-cell" style="padding:12px;">
            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Includes VAT</p>
            <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${vatAmount.toFixed(2)}</p>
          </td>
        </tr>
      </table>
    `;
  } else {
    paymentSummaryTable = `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; border:1px solid #e5e7eb;">
        <tr>
          <td class="payment-summary-cell" style="padding:12px; border-right:1px solid #e5e7eb;">
            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Amount Due</p>
            <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${Number(amountToPay).toFixed(2)}</p>
          </td>
          <td class="payment-summary-cell" style="padding:12px; border-right:1px solid #e5e7eb;">
            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Includes VAT</p>
            <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${vatAmount.toFixed(2)}</p>
          </td>
          <td class="payment-summary-cell" style="padding:12px;">
            <p style="margin:0; font-size:11px; color:#6b7280; text-transform:uppercase;">Total</p>
            <p style="margin:0; font-size:18px; font-weight:bold; color:#111827;">£${Number(totall).toFixed(2)}</p>
          </td>
        </tr>
      </table>
    `;
  }

  const mailOptions = {
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: customerEmail,
    subject: addStagingToSubject(`${getPaymentTypeDescription(paymentType)} Request for Task #${taskDetails.orderNumber}`),
    html: addStagingBanner(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    @media only screen and (max-width: 620px) {
      .main-table { width: 100% !important; }
      .stack { display:block !important; width:100% !important; }
      .inner { padding: 0 12px !important; }
      .center-mobile { text-align:center !important; }
      .payment-summary-cell { display:table-cell !important; width:auto !important; }
      .task-details-container { margin-bottom: 12px !important; }
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
              <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png"
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
                      ${getPaymentTypeDescription(paymentType)} Request
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
                    ${paymentSummaryTable}
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
                      ${tableHeader}
                      ${itemRows}
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
                        <td class="stack task-details-container" width="50%" style="padding-right:8px;">
                          ${taskDetailsHtml}
                        </td>
                        <td class="stack" width="50%" style="padding-left:8px;">
                          ${summaryBoxHtml}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 16px 12px;">
                    <p style="margin:0; font-size:12px; color:#4b5563; line-height:1.5;">
                      By clicking below and proceeding with payment, you are accepting our terms and conditions. Click here to view our <a href="https://www.londonwastemanagement.com/terms-conditions/" style="color:#34C759; text-decoration:underline;">terms and conditions</a>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 16px;">
                    <p style="margin:0; font-size:13px; color:#4b5563;">Choose a payment method below:</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:12px 16px 18px;">
                    <a href="${stripeLink}"
                      style="background:#635BFF; color:#ffffff; padding:10px 18px; font-size:13px; text-decoration:none; text-transform:uppercase; margin-right:6px; display:inline-block;">
                      Pay with Credit Card / Debit Card
                    </a>
                    <a href="${paypalLink}"
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
</html>`),
  };

  await transporter.sendMail(mailOptions);
  console.log(`Payment request email sent to ${customerEmail}`);
};

module.exports = sendPaymentEmail;

