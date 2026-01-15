// File: emailService.js
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');
const PDFDocument = require('pdfkit');
const Handlebars = require('handlebars');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');
const { addStagingToSubject, addStagingBanner } = require('../utils/emailHelpers');
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

function generatePDF(data, filePath) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(25).text('INVOICE', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Order Number: ${data.orderNumber}`);
  doc.text(`Billing To: ${data.firstName} ${data.lastName}`);
  doc.text(`Address: ${data.address}`);
  doc.text(`Email: ${data.email}`);
  doc.text(`Product: ${data.product}`);
  doc.text(`Subtotal: £${data.subtotal}`);
  doc.text(`VAT: £${data.vat}`);
  doc.text(`Total: £${data.total}`);
  doc.text(`Paid: £${data.paidAmount}`);
  doc.text(`Balance: £${data.balanceAmount}`);
  doc.end();
}
async function buildWasteTransferNoteDetails(task) {
  const itemDetails = await Promise.all(
    task.items.map(async (item) => {
      if (!item.standardItemId) {
        return {
          name: item.object || 'Other item',
          quantity: item.quantity || 1,
          price: item.price || 0,
          ewcCode: item.ewcCode || 'N/A', // Use custom item's EWC code
        };
      }

      const standardItem = await StandardItem.findById(item.standardItemId);
      return {
        name: standardItem?.itemName || 'Unnamed Item',
        quantity: item.quantity || 1,
        price: item.price || 0,
        ewcCode: standardItem?.ewcCode || 'N/A',
      };
    }),
  );

  return itemDetails;
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  try {
    // Add staging indicators
    const finalSubject = addStagingToSubject(subject);
    const finalHtml = addStagingBanner(html);

    return await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject: finalSubject,
      html: finalHtml,
      attachments,
    });
  } catch (error) {
    console.log(error);
    throw error;
  }
}

async function loadTaskData(taskId) {
  const task = await Task.findById(taskId).populate('items.standardItemId');
  if (!task) throw new Error('Task not found');

  const subtotal = task.totalPrice * 0.8;
  const vat = task.totalPrice * 0.2;
  const paid = task.paidAmount?.amount || 0;
  const balance = task.totalPrice - paid;

  const items = task.items.map((i) => ({
    name: i.standardItemId?.itemName || i.object || 'Unnamed Item',
    position: i.Objectsposition,
    quantity: i.quantity || 1,
    price: i.price || 0,
  }));

  return {
    firstName: task.firstName,
    lastName: task.lastName,
    email: task.email,
    phoneNumber: task.phoneNumber,
    orderNumber: task.orderNumber,
    date: task.date,
    available: task.available,
    subtotal,
    vat,
    total: task.totalPrice,
    paidAmount: paid,
    balanceAmount: balance,
    items,
  };
}

/**
 * Send a refund email with invoice PDF attached
 * @param {Object} params
 * @param {Object} params.task - The Task document
 * @param {Object} params.paymentHistory - The PaymentHistory document
 * @param {number} params.refundAmount - The amount refunded
 * @param {boolean} params.isSplitRefund - Whether the refund was split across multiple transactions
 * @param {Array} params.refundDetails - Array of refund details when split (optional)
 */
async function sendRefundEmail({ task, paymentHistory, refundAmount, isSplitRefund = false, refundDetails = [] }) {
  const fs = require('fs');
  const path = require('path');
  const templatePath = path.join(__dirname, '../public/templates/Refund.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  // Format refund type for display
  let refundTypeDisplay = 'Total Refund';
  if (task.paymentStatus === 'partial_Refunded') {
    refundTypeDisplay = 'Partial Refund';
  }

  const vars = {
    customerName: `${task.firstName} ${task.lastName}`,
    refundAmount: `£${refundAmount.toFixed(2)}`,
    orderNumber: task.orderNumber,
    refundType: refundTypeDisplay,
    logoPath: 'https://res.cloudinary.com/ddcsuzef0/image/upload/v1751659277/logo_cr9bor.png',
    footerWavesImage: 'https://res.cloudinary.com/ddcsuzef0/image/upload/v1751659277/image_cefof1.png',
    contactEmail: 'hello@londonwastemanagement.com',
    contactPhone: '02030971517',
    companyName: 'London Waste Management'
  };
  for (let key in vars) {
    html = html.replaceAll(`{{${key}}}`, vars[key]);
  }
  // Prepare dynamic values
  const name = `${task.firstName} ${task.lastName}`;
  const refundAmountStr = `£${refundAmount.toFixed(2)}`;
  const orderNumber = task.orderNumber;

  // Replace placeholders in template
  html = html.replace(/<span class="name">.*?<\/span>/, `<span class="name">${name}</span>`)
    .replace(/<span class="refund-amount">.*?<\/span>/, `<span class="refund-amount">${refundAmountStr}</span>`)
    .replace(/<span class="order-number">.*?<\/span>/, `<span class="order-number">${orderNumber}</span>`);

  // Add split refund explanation if applicable
  let splitRefundExplanation = '';
  if (isSplitRefund && refundDetails && refundDetails.length > 1) {
    const uniqueGateways = [...new Set(refundDetails.map(r => r.gateway))];
    const isCrossPlatform = uniqueGateways.length > 1;

    let explanationText = '';
    if (isCrossPlatform) {
      explanationText = `This refund has been processed across ${refundDetails.length} separate transactions using different payment methods (${uniqueGateways.join(' and ')}). `;
    } else {
      explanationText = `This refund has been processed across ${refundDetails.length} separate transactions. `;
    }

    explanationText += `You will receive the refund in the following amounts:`;

    const refundBreakdown = refundDetails.map((detail, index) => {
      return `<div style="margin: 8px 0; padding: 8px; background: #ffffff; border-left: 3px solid #4caf50;">
                <span style="font-weight: bold; color: #1c1c1c;">${detail.gateway}:</span>
                <span style="color: #1c1c1c; margin-left: 8px;">£${detail.amount.toFixed(2)}</span>
              </div>`;
    }).join('');

    splitRefundExplanation = `
      <div style="
        background: #fff9e6;
        padding: 16px 18px;
        margin: 20px 0;
        border-radius: 0px;
        border-left: 4px solid #ff9800;
      ">
        <p style="
          font-size: 15px;
          line-height: 1.6;
          margin-bottom: 12px;
          color: #333;
          font-weight: bold;
        ">
          ℹ️ Important Information:
        </p>
        <p style="
          font-size: 15px;
          line-height: 1.6;
          margin-bottom: 12px;
          color: #333;
        ">
          ${explanationText}
        </p>
        ${refundBreakdown}
        <p style="
          font-size: 14px;
          line-height: 1.6;
          margin-top: 12px;
          margin-bottom: 0;
          color: #666;
        ">
          Each transaction will appear separately in your account statement. The total refund amount is <strong>£${refundAmount.toFixed(2)}</strong>.
        </p>
      </div>
    `;
  }

  // Insert the split refund explanation after the refund details section
  // Find the closing div of the refund details section and insert after it
  if (splitRefundExplanation) {
    html = html.replace(
      /(<\/div>\s*<!-- Timeline Information -->)/,
      `${splitRefundExplanation}$1`
    );
  }

  // Generate and attach refund invoice PDF
  const dirPath = path.join(__dirname, '../generated');
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
  const fileName = `invoice-refund-${task.orderNumber}.pdf`;
  const filePath = path.join(dirPath, fileName);
  const isFullRefund = task.paymentStatus === 'refunded';
  await module.exports.generateOfficialInvoicePDF(task, filePath, {
    isRefund: true,
    refundAmount: refundAmount,
    isFullRefund: isFullRefund
  });

  await transporter.sendMail({
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to: task.email,
    subject: addStagingToSubject(`Refund for Order #${task.orderNumber}`),
    html: addStagingBanner(html),
    attachments: [{ filename: fileName, path: filePath }],
  });
  fs.unlinkSync(filePath);
}

module.exports = {
  async generateOfficialInvoicePDF(task, outputPath, refundInfo = null) {
    const templatePath = path.join(
      __dirname,
      '../public/invoice-template.html',
    );
    let template = fs.readFileSync(templatePath, 'utf8');

    const iconDir = path.join(__dirname, '../public/invoice-icons');


    const asset = (name) => {
      const filePath = path.resolve(iconDir, name);
      // Read file and convert to base64
      const fileBuffer = fs.readFileSync(filePath);
      const base64 = fileBuffer.toString('base64');
      const mimeType = name.endsWith('.png')
        ? 'image/png'
        : name.endsWith('.svg')
          ? 'image/svg+xml'
          : name.endsWith('.ttf')
            ? 'font/ttf'
            : 'image/png';
      return `data:${mimeType};base64,${base64}`;
    };

    let subtotal = 0;
    let vat = 0;
    let total = 0;
    let itemDiscountTotal = 0; // Track total item discount for per-item discounts
    let subtotalBeforeDiscounts = 0; // Track subtotal with original prices (before per-item discounts)

    // Calculate subtotal and handle discounts based on discountType
    task.items.forEach((item) => {
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

      // Always add to subtotalBeforeDiscounts (original prices)
      subtotalBeforeDiscounts += itemSubtotal;

      // Handle item-specific discount only if hasDiscount is true and discountType is "perItem"
      let finalItemTotal = itemSubtotal;
      if (task.hasDiscount && task.discountType === "perItem" && item.customPrice) {
        const customPrice = Number(item.customPrice);
        finalItemTotal = (customPrice * item.quantity) + positionPrice;
        // Calculate discount: (originalPrice - customPrice) * quantity
        const originalItemPrice = item.standardItemId
          ? Number(item.standardItemId.price)
          : Number(item.price);
        itemDiscountTotal += (originalItemPrice - customPrice) * item.quantity;
      }

      subtotal += finalItemTotal;
    });
    let percentageDiscount = 0;
    // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
    if (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
      percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
      subtotal -= percentageDiscount;
    }

    // Calculate 10% discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
    const isAvailableAnyTime = task.available === 'AnyTime';
    const isCreatedByPublic = task.createdByType === 'public';
    const hasItems = task.items && task.items.length > 0;
    const allItemsOutside = hasItems && task.items.every((i) => i.Objectsposition === 'Outside');

    let automaticDiscount10Percent = 0;
    if (isAvailableAnyTime && isCreatedByPublic && hasItems && allItemsOutside) {
      console.log('✅ Applying 10% discount for Outside items with AnyTime and public type in invoice PDF');
      automaticDiscount10Percent = subtotal * 0.1;
      subtotal *= 0.9;
    }

    // Handle coupon discount if exists
    let couponDiscount = 0;
    let couponCode = null;
    let couponPercentage = 0;
    if (task.couponCode) {
      try {
        const Coupon = require('../models/Coupon');
        const coupon = await Coupon.findOne({ code: task.couponCode });
        if (coupon) {
          couponCode = coupon.code;
          couponPercentage = coupon.percentage;
          // Calculate coupon discount on subtotal after other discounts
          couponDiscount = (subtotal * couponPercentage) / 100;
          subtotal -= couponDiscount;
        }
      } catch (error) {
        console.error('Error fetching coupon for PDF invoice:', error);
      }
    }

    // Check createdByType condition for minimum price enforcement
    // Only skip minimum price if explicitly 'Admin' AND applyMinFee is false
    const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
    console.log('=== INVOICE PDF PRICE CALCULATION ===');
    console.log('task.createdByType:', task.createdByType, 'Type:', typeof task.createdByType);
    console.log('task.applyMinFee:', task.applyMinFee);
    console.log('enforceMinimumPrice:', enforceMinimumPrice);
    console.log('subtotal before minimum check:', subtotal);

    // Apply minimum price (before VAT) - if under £37.5, make it £37.5 (=> £45 with VAT)
    if (enforceMinimumPrice && subtotal < 37.5) {
      console.log('Applying minimum price adjustment: £' + subtotal + ' → £37.5');
      subtotal = 37.5;
    } else {
      console.log('Minimum price NOT applied (Admin task without applyMinFee or subtotal >= 37.5)');
    }

    console.log("subtotal", subtotal)
    vat = subtotal * 0.2;
    total = subtotal + vat;

    console.log("task.items", task.items);
    console.log("discountType:", task.discountType);
    console.log("hasDiscount:", task.hasDiscount);

    const itemRows = task.items
      .map((item) => {
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

        // Handle different discount types
        let finalItemTotal = itemSubtotal;
        let discountedPrice = itemSubtotal;

        if (task.hasDiscount && task.discountType === "perItem" && item.customPrice) {
          discountedPrice = item.customPrice;
          finalItemTotal = (discountedPrice * item.quantity) + positionPrice;
        }

        // Check if any items have custom prices to determine if we need discount column
        const hasCustomPrices = task.items.some(item => item.customPrice);
        const showDiscountColumn = task.hasDiscount && task.discountType === "perItem" && hasCustomPrices;

        // Get the correct price for display
        const displayPrice = item.standardItemId
          ? (item.standardItemId.price || 0)
          : (item.price || 0);

        if (showDiscountColumn) {
          return `
          <tr>
            <td>
            ${item.standardItemId?.itemName || item.object || 'Unnamed Item'}</td>
            <td>${item.quantity}</td>
            <td>£${displayPrice.toFixed(2)}</td>
            <td>£${item.customPrice ? discountedPrice.toFixed(2) : displayPrice.toFixed(2)}</td>
            <td>${item.Objectsposition}</td>
            <td>£${positionPricePerUnit.toFixed(2)}</td>
            <td>£${finalItemTotal.toFixed(2)}</td>
          </tr>`;
        } else {
          return `
          <tr>
            <td>${item.standardItemId?.itemName || item.object || 'Unnamed Item'
            }</td>
            <td>${item.quantity}</td>
            <td>£${displayPrice.toFixed(2)}</td>
            <td>${item.Objectsposition}</td>
            <td>£${positionPricePerUnit.toFixed(2)}</td>
            <td>£${finalItemTotal.toFixed(2)}</td>
          </tr>`;
        }
      })
      .join('');

    // Determine if payment is fully paid
    const isFullyPaid = task.paymentStatus === 'Paid' ||
      (task.paidAmount?.status === 'Paid' && task.remainingAmount?.status === 'Paid');

    // Handle refund information
    const isRefund = refundInfo && refundInfo.isRefund;
    const refundAmount = refundInfo ? refundInfo.refundAmount : 0;
    const isFullRefund = refundInfo ? refundInfo.isFullRefund : false;
    const showRefundBadge = isRefund ? 'block' : 'none';
    const showFullRefundBadge = isRefund && isFullRefund ? 'block' : 'none';
    const showPartialRefundBadge = isRefund && !isFullRefund ? 'block' : 'none';
    const showRefundRow = isRefund ? 'block' : 'none';

    // Adjust total by subtracting refund amount if there's a refund
    if (isRefund && refundAmount > 0) {
      total = Math.max(0, total - refundAmount);
    }

    // Detect if this is a DEPOSIT payment (partial payment where deposit is paid but remaining is not)
    // A deposit is when: paymentStatus is 'partial_Paid', paidAmount is 'Paid', and remainingAmount is 'Not_Paid'
    const isDeposit = task.paymentStatus === 'partial_Paid' &&
      task.paidAmount?.status === 'Paid' &&
      task.remainingAmount?.status === 'Not_Paid';
    const showDepositBadge = isDeposit ? 'block' : 'none';

    // Hide payment status badges when it's a refund invoice or a deposit payment
    // When it's a deposit, only show the deposit badge, not the PAID/NOT PAID badges
    const paymentStatusPaidDisplay = (isRefund || isDeposit) ? 'none' : (isFullyPaid ? 'block' : 'none');
    const paymentStatusUnpaidDisplay = (isRefund || isDeposit) ? 'none' : (!isFullyPaid ? 'block' : 'none');

    const vars = {
      billingName: `${task.firstName} ${task.lastName}`,
      billingAddress: task.billingAddress,
      email: task.email,
      postcode: task.postcode,
      phone: task.phoneNumber,
      phone2: task.phoneNumber2,
      invoiceNumber: task.orderNumber,
      orderNumber: task.orderNumber,
      invoiceDate: task.createdAt ? new Date(task.createdAt).toLocaleDateString('en-GB') : '',
      orderDate: task.date ? new Date(task.date).toLocaleDateString('en-GB') : '',
      serviceDate: new Date(task.date).toLocaleDateString('en-GB'),
      available: task.available === 'AnyTime' ? 'Any time (6:30am to 8:30pm)' :
        task.available === '7am-12pm' ? 'Morning (7am to 12pm)' :
          task.available === '12pm-5pm' ? 'Afternoon (12pm to 5pm)' : task.available,
      itemRows,
      // Always show subtotal with original prices (before all discounts)
      subtotal: (subtotalBeforeDiscounts || 0).toFixed(2),
      vat: (vat || 0).toFixed(2),
      totalPrice: (total || 0).toFixed(2),
      hasDiscount: task.hasDiscount,
      discountType: task.discountType || 'percentage',
      customDiscountPercent: (task.customDiscountPercent || 0).toFixed(2),
      paymentMethod: task.paymentMethod,
      additionalNotes: task.additionalNotes,
      privateNotes: task.privateNotes,
      businessName: task.bussinessName,
      collectionAddress: task.collectionAddress,
      // Payment status for stamps - hide when it's a refund invoice
      paymentStatusPaid: paymentStatusPaidDisplay,
      paymentStatusUnpaid: paymentStatusUnpaidDisplay,
      // Discount display logic based on discount type
      showDiscountRow:
        (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) ||
          (task.hasDiscount && task.discountType === "perItem")
          ? 'block'
          : 'none',
      discountLabel:
        task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0
          ? `Discount (${task.customDiscountPercent}%)`
          : task.hasDiscount && task.discountType === "perItem"
            ? 'Item Discounts'
            : 'Discount',
      // discountAmount: task.hasDiscount && (task.discountType === "percentage" || task.customDiscountPercent > 0)
      //   ? discountAmount.toFixed(2)
      //   : '0.00',
      discountAmount: (task.hasDiscount && task.discountType === "perItem")
        ? itemDiscountTotal.toFixed(2)
        : percentageDiscount.toFixed(2),
      // Asset paths with base64 encoding
      logoPath: asset('london_waste_logo 1.png'),
      bgPath: asset('green-bg.png'),
      locationIcon: asset('location-pin-svgrepo-com 1.png'),
      vatIcon: asset('product-o-svgrepo-com 1.png'),
      emailIcon: asset('email-svgrepo-com 1.png'),
      phoneIcon: asset('phone-svgrepo-com 1.png'),
      calendarIcon: asset('Vector.png'),
      ArrowIcon: asset('Vector 3.png'),
      clockIcon: asset('Group 4.png'),
      fontRegular: asset('Lato-Regular.ttf'),
      fontBold: asset('lato-bold.ttf'),
      // Refund information
      showRefundBadge,
      showFullRefundBadge,
      showPartialRefundBadge,
      showRefundRow,
      refundAmount: refundAmount ? refundAmount.toFixed(2) : '0.00',
      fullRefundBadgeUrl: 'https://res.cloudinary.com/dehzhd6xs/image/upload/v1763994713/king_q_2_3_r6ij4f.png',
      partialRefundBadgeUrl: 'https://res.cloudinary.com/dehzhd6xs/image/upload/v1763994706/king_q_2_4_vu3kji.png',
      // Deposit badge information
      showDepositBadge,
      depositBadgeUrl: 'https://res.cloudinary.com/dehzhd6xs/image/upload/v1764167162/king_q_2_5_1_skicfb.png',
      // 10% automatic discount information
      hasAutomaticDiscount: automaticDiscount10Percent > 0,
      automaticDiscountAmount: automaticDiscount10Percent.toFixed(2),
    };

    // Build discount columns for the table header based on discount type
    let discountColumns = '';
    const hasCustomPrices = task.items.some(item => item.customPrice);
    if (task.hasDiscount && task.discountType === "perItem" && hasCustomPrices) {
      discountColumns = '<th>Discounted Price</th>';
    }
    template = template.replace('{{discountColumns}}', discountColumns);

    // Build discount row for the summary based on discount type
    let discountRow = '';
    // Show 10% automatic discount if applicable
    if (vars.hasAutomaticDiscount) {
      discountRow += `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n              <div class="summary-row">\n                <span class="summary-label">Discount (10%)</span>\n                <span class="summary-value">-£${vars.automaticDiscountAmount}</span>\n              </div>`;
    }
    // Show other discounts (percentage or per-item) if applicable
    if (vars.hasDiscount && ((task.discountType === "percentage" && task.customDiscountPercent > 0) || task.discountType === "perItem")) {
      discountRow += `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n              <div class="summary-row">\n                <span class="summary-label">${vars.discountLabel}</span>\n                <span class="summary-value">-£${vars.discountAmount}</span>\n              </div>`;
    }
    // Show coupon discount if applicable
    if (couponCode && couponDiscount > 0) {
      discountRow += `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n              <div class="summary-row">\n                <span class="summary-label">Coupon Discount (${couponCode} - ${couponPercentage}%)</span>\n                <span class="summary-value">-£${couponDiscount.toFixed(2)}</span>\n              </div>`;
    }
    template = template.replace('{{discountRow}}', discountRow);

    // Build refund row for the summary
    let refundRow = '';
    if (isRefund && refundAmount > 0) {
      refundRow = `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n        <div class="summary-row"><span class="summary-label">Refunded Amount</span><span class="summary-value">-£${vars.refundAmount}</span></div>`;
    }
    template = template.replace('{{refundRow}}', refundRow);

    // Build bank transfer details section if payment method is BankTransfer
    let bankTransferDetails = '';
    if (task.paymentMethod === 'BankTransfer') {
      bankTransferDetails = `
          <div class="bank-details-section">
            <div class="bank-details-header">
              <span>🏦 Bank Details:</span>
            </div>
            <div class="bank-details-content">
              <div class="value"><strong>Business Account Name:</strong> London Waste Management</div>
              <div class="value"><strong>Sort Code:</strong> 30-96-26</div>
              <div class="value"><strong>Account Number:</strong> 55867268</div>
              <div class="value"><strong>Reference:</strong> ${task.orderNumber}</div>
            </div>
          </div>`;
    }
    template = template.replace('{{bankTransferDetails}}', bankTransferDetails);

    // Now do the rest of your variable replacements as before
    for (let key in vars) {
      template = template.replaceAll(`{{${key}}}`, vars[key]);
    }

    // Debug: Save the template to check paths
    fs.writeFileSync(
      path.join(__dirname, '../public/debug-template.html'),
      template,
    );

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Set content and wait for network to be idle
    await page.setContent(template, {
      waitUntil: 'networkidle',
      timeout: 30000, // Increase timeout to 30 seconds
    });

    // Wait for images to load
    await page.waitForLoadState('networkidle');

    // Debug: Check if images are loaded
    const imageStatus = await page.evaluate(() => {
      const images = Array.from(document.getElementsByTagName('img'));
      return images.map((img) => ({
        src: img.src.substring(0, 50) + '...', // Truncate base64 string for logging
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }));
    });

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    await context.close();
    await browser.close();
  },

  async sendPartialPaymentNotification(taskId) {
    const data = await Task.findById(taskId).populate('items.standardItemId');
    console.log(data);
    const filePath = `./invoice-${data.orderNumber}.pdf`;
    await generateOfficialInvoicePDF(data, filePath);

    await sendEmail({
      to: 'hello@londonwastemanagement.com',
      subject: `New Order #${data.orderNumber}`,
      html: `<p>New partial payment received for Order #${data.orderNumber}.</p>`,
      attachments: [{ path: filePath }],
    });

    await sendEmail({
      to: data.email,
      subject: `Your Order #${data.orderNumber} Confirmation`,
      html: `<p>Thank you ${data.firstName}, balance due on arrival: £${data.balanceAmount}</p>`,
      attachments: [{ path: filePath }],
    });

    fs.unlinkSync(filePath);
  },

  async sendPaymentLinkEmail(taskId, paymentLink) {
    const data = await loadTaskData(taskId);
    const filePath = `./invoice-${data.orderNumber}.pdf`;
    generatePDF(data, filePath);

    await sendEmail({
      to: data.email,
      subject: `Payment Link for Order #${data.orderNumber}`,
      html: `<p>Pay here: <a href="${paymentLink}">${paymentLink}</a></p>`,
      attachments: [{ path: filePath }],
    });

    fs.unlinkSync(filePath);
  },

  async sendPaymentReceivedEmail(taskId) {
    const data = await loadTaskData(taskId);
    const filePath = `./invoice-${data.orderNumber}.pdf`;
    generatePDF(data, filePath);

    await sendEmail({
      to: data.email,
      subject: `Payment Received for Order #${data.orderNumber}`,
      html: `<p>Thank you ${data.firstName}, your payment has been received. No further action required.</p>`,
      attachments: [{ path: filePath }],
    });

    fs.unlinkSync(filePath);
  },

  async sendReviewRequestEmail(taskId) {
    const task = await Task.findById(taskId);
    if (!task) throw new Error('Task not found');

    const baseReviewLink = `https://lwmadmin.netlify.app/review/${task.orderNumber}`;
    const trustpilotLink = `https://www.trustpilot.com/evaluate/www.londonwastemanagement.com`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management"/>
        </div>
        
        <div style="background-color: #8dc044; color: white; padding: 10px; text-align: center; border-radius: 4px;">
          <h2 style="margin: 0;">How did we do?</h2>
        </div>
  
        <div style="padding: 20px 0;">
          <p>Hi ${task.firstName} ${task.lastName},</p>
          <p>Thank you for choosing LWM for your recent removal and recycling collection.</p>
          <p>We would love it if you could help us and other customers by rating your experience with us. It only takes a few clicks and would be sincerely appreciated!</p>
          <p>Kind regards,</p>
          <h3>How Was Your Experience?</h3>
  
          <table width="100%" cellpadding="10" cellspacing="0" style="text-align: center; margin: 20px 0;">
            <tr>
              <td>☹️</td>
              <td>
                <a href="${baseReviewLink}">⭐</a>
                <a href="${baseReviewLink}">⭐</a>
                
              </td>
            </tr>
            <tr>
              <td>😐</td>
              <td>
                <a href="${baseReviewLink}">⭐</a>
                <a href="${baseReviewLink}">⭐</a>
                <a href="${baseReviewLink}">⭐</a>
               
             
            </tr>
            <tr>
              <td>🙂</td>
              <td>
                <a href="${trustpilotLink}">⭐</a>
                <a href="${trustpilotLink}">⭐</a>
                <a href="${trustpilotLink}">⭐</a>
                <a href="${trustpilotLink}">⭐</a>
                <a href="${trustpilotLink}">⭐</a>
              </td>
            </tr>
          </table>
        </div>
  
        <footer style="text-align: center; font-size: 12px; color: #888;">
          <p>London Waste Management | hello@londonwastemanagement.com</p>
        </footer>
      </div>
    `;

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: addStagingToSubject('London Waste Management - Customer Review'),
      html: addStagingBanner(htmlContent),
    });
  },

  async sendQuoteRequestConfirmationEmail(email, newQuotation) {
    const htmlContent =
      `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            .section {
              padding: 0;
            }
            .main-table {
              width: 600px;
              max-width: 600px;
            }
            .content-card {
              padding: 40px 48px 42px;
            }
            .content-wrapper {
              padding: 0;
            }
            .inner-content-box {
              padding: 32px;
            }
            @media only screen and (max-width: 620px) {
              .main-table {
                width: 100% !important;
                max-width: 100% !important;
              }
              .content-card {
                padding: 24px !important;
              }
              .hero {
                padding: 0 !important;
              }
              .hero img {
                width: 100% !important;
                max-width: 100% !important;
                display: block !important;
              }
              .content-wrapper {
                padding: 0 16px !important;
              }
              .section:not(.hero) {
                padding: 0 16px 24px !important;
              }
              .thankyou {
                padding: 24px 16px 16px !important;
              }
              .inner-content-box {
                padding: 24px !important;
              }
            }
          </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" class="main-table" style="border-collapse: collapse; margin: 0 auto; padding: 0; width: 100%; max-width: 600px; background: #ffffff;">
            <tr>
              <td class="section hero" style="padding: 0; line-height: 0;" align="center">
                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png" alt="London Waste Management" width="600" style="display: block; width: 600px; max-width: 100%; height: auto; margin: 0; border: 0; line-height: 0;" />
              </td>
            </tr>
            <tr>
              <td class="section thankyou" style="padding: 24px 0 16px; text-align: center;">
                <p style="margin: 0; font-size: 26px; font-weight: 700; color: #111;">
                  <span style="color: #c5f3c3; font-size: 34px;">"</span>
                  Thank You !
                  <span style="color: #c5f3c3; font-size: 34px;">"</span>
                </p>
              </td>
            </tr>
            <tr>
              <td class="section content-wrapper" style="padding: 0 0 34px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: none;">
                  <tr>
                    <td class="content-card" style="color: #232b25; background: #ffffff; padding: 40px 48px 42px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="box-shadow: 0 4px 20px rgba(0,0,0,0.12); border-radius: 8px; background: #ffffff;">
                        <tr>
                          <td class="inner-content-box" style="padding: 32px;">
                            <p style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">
                              <span style="color: #000000;">Dear</span>
                              <span style="color: #111111;"> ${newQuotation.Name},</span>
                            </p>
                            <div style="width: 92px; height: 5px; background: #28c152; margin: 0 0 24px;"></div>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 18px; color: #374237;">
                              Thank you for your quotation request. We have received your submission and will get back to you as soon as possible.
                            </p>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 22px; color: #374237;">
                              If you have any questions or need assistance, please contact us at
                              <a href="mailto:hello@londonwastemanagement.com" style="color: #169b4f; text-decoration: none;">hello@londonwastemanagement.com</a>
                              or call us on <a href="tel:02030971517" style="color: #169b4f; text-decoration: none; font-weight: 600;">0203 097 1517</a>.
                            </p>
                            <p style="font-size: 15px; margin: 24px 0 4px; color: #4f5b52;">Best regards,</p>
                            <p style="font-size: 16px; font-weight: bold; color: #169b4f; margin: 0;">London Waste Management Department</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 24px; text-align: center; font-size: 12px; color: #5f6b66; border-top: 1px solid #e5f3e1;">
                London Waste Management &nbsp;|&nbsp;
                <a href="mailto:hello@londonwastemanagement.com" style="color: #169b4f; text-decoration: none;">hello@londonwastemanagement.com</a>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: addStagingToSubject('Thank You for Your Quotation Request'),
      html: addStagingBanner(htmlContent),
    });
  },

  async sendWasteTransferNoteEmail(taskId) {
    // Use atomic operation to prevent race conditions - only update if not already sent
    const task = await Task.findOneAndUpdate(
      {
        _id: taskId,
        wasteTransferNoteSent: { $ne: true } // Only match if not already sent
      },
      {
        $set: { wasteTransferNoteSent: true } // Atomically set the flag
      },
      {
        new: true // Return updated document
      }
    ).populate('items.standardItemId');

    // If task is null, it means either task doesn't exist or email was already sent
    if (!task) {
      // Check if task exists but email was already sent
      const existingTask = await Task.findById(taskId);
      if (existingTask && existingTask.wasteTransferNoteSent) {
        // Email already sent, silently return
        return;
      }
      throw new Error('Task not found');
    }

    const templatePath = path.join(__dirname, '../public/templates/wastenote.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    // Build product rows as HTML table rows (one row per product)
    const productRows = task.items
      .map((item) => {
        const name = item.standardItemId?.itemName || item.object || 'Unnamed Item';
        const quantity = item.quantity || 1;
        const price = (item.price || item.standardItemId?.price || 0).toFixed(2);
        return `<tr>
  <td style="padding: 8px 10px; border-bottom: 1px solid #f3f4f6;">${name}</td>
  <td style="padding: 8px 10px; border-bottom: 1px solid #f3f4f6; text-align: center;">${quantity}</td>
  <td style="padding: 8px 10px; border-bottom: 1px solid #f3f4f6; text-align: right;">£${price}</td>
</tr>`;
      })
      .join('');

    // Build EWC codes - include both standard and custom items
    const ewcCodes = task.items
      .filter(i => {
        // Include if it's a standard item with EWC code OR a custom item with EWC code
        return (i.standardItemId?.ewcCode) || (i.ewcCode);
      })
      .map(i => {
        const code = i.standardItemId?.ewcCode || i.ewcCode;
        const name = i.standardItemId?.itemName || i.object || 'Unnamed Item';
        return `<p><span class="text-[#8bc53f]">${code}</span> : ${name}</p>`;
      })
      .join('');

    // Helper function to escape HTML and convert newlines to <br>
    const formatNotes = (notes) => {
      if (!notes) return 'No additional notes provided.';
      // Escape HTML special characters
      const escaped = notes
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      // Convert newlines to <br> tags
      return escaped.replace(/\n/g, '<br>');
    };

    // Replace placeholders
    template = template.replace(/{{firstName}}/g, task.firstName);
    template = template.replace(/{{orderNumber}}/g, task.orderNumber);
    template = template.replace(/{{date}}/g, task.date.toISOString().split('T')[0]);
    template = template.replace(/{{productRows}}/g, productRows);
    template = template.replace(/{{ewcCodes}}/g, ewcCodes || '');
    template = template.replace(/{{collectionAddress}}/g, task.collectionAddress || '');
    template = template.replace(/{{timeSlot}}/g, task.available?.replace(/_/g, ' ') || '');
    template = template.replace(/{{additionalNotes}}/g, formatNotes(task.additionalNotes));

    try {
      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: task.email,
        subject: addStagingToSubject(`Waste Transfer Note for Order #${task.orderNumber}`),
        html: addStagingBanner(template),
      });
    } catch (error) {
      // If email fails, reset the flag so it can be retried
      await Task.findByIdAndUpdate(taskId, { $set: { wasteTransferNoteSent: false } });
      throw error;
    }
  },

  async sendGeneralInvoiceEmail(taskId) {
    const task = await Task.findById(taskId).populate('items.standardItemId');
    if (!task || !task.orderNumber)
      throw new Error('Invalid task or missing order number');

    const dirPath = path.join(__dirname, '../generated');
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);

    const fileName = `invoice-${task.orderNumber}.pdf`;
    const filePath = path.join(dirPath, fileName);

    await generateOfficialInvoicePDF(task, filePath);

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: addStagingToSubject(`Invoice for Order #${task.orderNumber}`),
      html: addStagingBanner(`<p>Please find attached your official invoice for Order #${task.orderNumber}.</p>`),
      attachments: [{ filename: fileName, path: filePath }],
    });

    fs.unlinkSync(filePath);
  },
  async sendBookingConfirmationEmail(taskId) {
    const task = await Task.findById(taskId).populate('items.standardItemId');
    if (!task) throw new Error('Task not found');

    // Read the template file
    const templatePath = path.join(__dirname, '../public/templates/bookingConfirmation.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    // Replace template variables
    template = template.replace('{{firstName}}', task.firstName);
    template = template.replace('{{lastName}}', task.lastName);
    template = template.replace('{{orderNumber}}', task.orderNumber);
    template = template.replace('{{date}}', task.date.toLocaleDateString('en-GB'));
    template = template.replace('{{available}}', task.available === 'AnyTime' ? 'anytime (6:30am to 8:30pm)' :
      task.available === '7am-12pm' ? 'morning (7am to 12pm)' :
        task.available === '12pm-5pm' ? 'afternoon (12pm to 5pm)' : task.available);
    template = template.replace('{{businessName}}', task.bussinessName);
    template = template.replace('{{collectionAddress}}', task.collectionAddress);

    // Template now has all styles inline, no need to add external CSS
    const htmlContent = template;

    // Generate invoice PDF
    const dirPath = path.join(__dirname, '../generated');
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
    const fileName = `invoice-${task.orderNumber}.pdf`;
    const filePath = path.join(dirPath, fileName);
    await module.exports.generateOfficialInvoicePDF(task, filePath);

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: addStagingToSubject(`Booking Confirmation - Order #${task.orderNumber}`),
      html: addStagingBanner(htmlContent),
      attachments: [{ filename: fileName, path: filePath }],
    });

    fs.unlinkSync(filePath);
  },
  async sendPaymentConfirmationEmail({ email, firstName, lastName, orderId, paymentDate, amount, currency, paymentType, breakdown }) {
    try {
      // Load the task to get order number and other details
      const task = await Task.findById(orderId).populate('items.standardItemId');
      if (!task) {
        throw new Error(`Task not found with ID: ${orderId}`);
      }

      // Generate invoice PDF
      const dirPath = path.join(__dirname, '../generated');
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
      const fileName = `invoice-${task.orderNumber}.pdf`;
      const filePath = path.join(dirPath, fileName);
      await module.exports.generateOfficialInvoicePDF(task, filePath);

      // Read the payment confirmation template
      const templatePath = path.join(__dirname, '../public/templates/paymentConfirmation.html');
      const templateSource = fs.readFileSync(templatePath, 'utf8');

      // Verify template was read correctly and contains header sections
      if (!templateSource.includes('<!-- Header Image -->') || !templateSource.includes('<!-- Payment Confirmation Banner Section -->')) {
        console.error('❌ ERROR: Template file is missing header sections!');
        throw new Error('Template file structure is invalid - missing header sections');
      }

      // Calculate subtotal, discount, VAT, and total from task (same as invoice)
      let subtotalBeforeDiscounts = 0;
      let itemDiscountTotal = 0; // Track total item discount for per-item discounts

      // Calculate subtotal from items (before discounts)
      task.items.forEach((item) => {
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

        // Handle item-specific discount only if hasDiscount is true and discountType is "perItem"
        if (task.hasDiscount && task.discountType === "perItem" && item.customPrice) {
          const customPrice = Number(item.customPrice);
          // Calculate discount: (originalPrice - customPrice) * quantity
          const originalItemPrice = item.standardItemId
            ? Number(item.standardItemId.price)
            : Number(item.price);
          itemDiscountTotal += (originalItemPrice - customPrice) * item.quantity;
        }

        subtotalBeforeDiscounts += itemSubtotal;
      });

      // Calculate 10% discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
      const isAvailableAnyTime = task.available === 'AnyTime';
      const isCreatedByPublic = task.createdByType === 'public';
      const hasItems = task.items && task.items.length > 0;
      const allItemsOutside = hasItems && task.items.every((i) => i.Objectsposition === 'Outside');

      let automaticDiscount10Percent = 0;
      let subtotal = subtotalBeforeDiscounts;
      if (isAvailableAnyTime && isCreatedByPublic && hasItems && allItemsOutside) {
        automaticDiscount10Percent = subtotal * 0.1;
        subtotal *= 0.9;
      }

      // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
      let percentageDiscount = 0;
      if (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
        percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
        subtotal -= percentageDiscount;
      }

      // Handle coupon discount if exists
      let couponDiscount = 0;
      let couponCode = null;
      let couponPercentage = 0;
      if (task.couponCode) {
        try {
          const Coupon = require('../models/Coupon');
          // Normalize coupon code to uppercase to match Coupon model storage
          const normalizedCouponCode = String(task.couponCode).trim().toUpperCase();
          const coupon = await Coupon.findOne({ code: normalizedCouponCode });
          if (coupon) {
            couponCode = coupon.code;
            couponPercentage = coupon.percentage;
            // Calculate coupon discount on subtotal after other discounts
            couponDiscount = (subtotal * couponPercentage) / 100;
            subtotal -= couponDiscount;
          } else {
            console.warn(`Coupon code "${normalizedCouponCode}" not found in database for task ${task.orderNumber}`);
          }
        } catch (error) {
          console.error('Error fetching coupon for payment confirmation email:', error);
        }
      }

      // Apply minimum price (before VAT) - if under £37.5, make it £37.5
      const enforceMinimumPrice = task.createdByType !== 'Admin' || task.applyMinFee === true;
      if (enforceMinimumPrice && subtotal < 37.5) {
        subtotal = 37.5;
      }

      // Calculate VAT and total
      const vat = subtotal * 0.2;
      const total = subtotal + vat;

      // Calculate total discount amount for display (subtotal before discounts - subtotal after discounts)
      const subtotalAfterDiscounts = subtotal;
      const totalDiscountAmount = subtotalBeforeDiscounts - subtotalAfterDiscounts;

      // Detect if this is a DEPOSIT payment
      const isDeposit = task.paymentStatus === 'partial_Paid' &&
        task.paidAmount?.status === 'Paid' &&
        task.remainingAmount?.status === 'Not_Paid';

      // Get payment method - use paymentType (Stripe/PayPal) directly
      // paymentType is passed as 'Stripe' or 'PayPal' from the webhook/controller
      // If not provided, try to get from PaymentHistory
      let paymentMethod = paymentType;

      if (!paymentMethod || paymentMethod === 'Payment' || paymentMethod === 'N/A') {
        // Try to get from PaymentHistory
        const PaymentHistory = require('../models/PaymentHistory');
        const latestPayment = await PaymentHistory.findOne({ taskId: task._id })
          .sort({ paymentDate: -1 });

        if (latestPayment && latestPayment.paymentType) {
          paymentMethod = latestPayment.paymentType; // Should be 'Stripe' or 'PayPal'
        } else {
          paymentMethod = 'Online Payment';
        }
      }

      // Build breakdown table HTML if provided
      let breakdownTableHtml = '';
      if (breakdown && Array.isArray(breakdown) && breakdown.length > 0) {
        // Determine if we need quantity column (only if any item has quantity)
        const hasQuantity = breakdown.some(item => item.quantity && item.quantity > 0 && !item.description?.toLowerCase().includes('total') && !item.description?.toLowerCase().includes('payment method'));

        // Separate items from summary rows (Total, Payment Method, etc.)
        const itemRows = [];
        const summaryRows = [];

        breakdown.forEach((item) => {
          const description = item.description || item.itemDescription || 'Item';
          const itemAmount = item.amount || item.price;
          const quantity = item.quantity || 1;

          // Check if this is a summary row (Total, Payment Method, etc.)
          const isSummaryRow = description.toLowerCase().includes('total') ||
            description.toLowerCase().includes('payment method') ||
            description.toLowerCase().includes('vat');

          // Check if this is a Payment Method entry (non-numeric amount)
          const isPaymentMethod = description.toLowerCase().includes('payment method');
          const isNumeric = !isNaN(parseFloat(itemAmount)) && isFinite(itemAmount);

          let amountCell = '';
          if (isPaymentMethod) {
            // For Payment Method, use the paymentType parameter instead of the email address
            amountCell = `<td style="text-align: right; padding: 10px; border-bottom: 1px solid #e0e0e0;">${paymentType || 'N/A'}</td>`;
          } else if (!isNumeric) {
            // For other non-numeric values, just show the value as text
            amountCell = `<td style="text-align: right; padding: 10px; border-bottom: 1px solid #e0e0e0;">${itemAmount || 'N/A'}</td>`;
          } else {
            // For numeric amounts, format as currency
            amountCell = `<td style="text-align: right; padding: 10px; border-bottom: 1px solid #e0e0e0;">£${parseFloat(itemAmount).toFixed(2)}</td>`;
          }

          // Show quantity only for item rows (not summary rows)
          const showQuantity = !isSummaryRow && item.itemDescription && quantity > 0;
          const quantityCell = showQuantity
            ? `<td style="text-align: center; padding: 10px; border-bottom: 1px solid #e0e0e0;">${quantity}</td>`
            : '';

          // For summary rows, add empty quantity cell if quantity column exists
          const finalQuantityCell = isSummaryRow && hasQuantity
            ? '<td style="text-align: center; padding: 10px; border-bottom: 1px solid #e0e0e0;"></td>'
            : quantityCell;

          const rowHtml = `
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; ${isSummaryRow ? 'font-weight: bold;' : ''}">${description}</td>
              ${finalQuantityCell}
              ${amountCell}
            </tr>`;

          if (isSummaryRow) {
            summaryRows.push(rowHtml);
          } else {
            itemRows.push(rowHtml);
          }
        });

        // Add VAT and Total rows if not already in breakdown
        const hasVAT = summaryRows.some(row => row.toLowerCase().includes('vat'));
        const hasTotal = summaryRows.some(row => row.toLowerCase().includes('total amount'));

        if (!hasVAT) {
          const vatRowQuantityCell = hasQuantity
            ? '<td style="text-align: center; padding: 10px; border-bottom: 1px solid #e0e0e0;"></td>'
            : '';
          summaryRows.unshift(`<tr><td style="padding: 10px; border-bottom: 1px solid #e0e0e0;">VAT (20%)</td>${vatRowQuantityCell}<td style="text-align: right; padding: 10px; border-bottom: 1px solid #e0e0e0;">£${vat.toFixed(2)}</td></tr>`);
        }
        if (!hasTotal) {
          const totalRowQuantityCell = hasQuantity
            ? '<td style="text-align: center; padding: 10px; border-bottom: 1px solid #e0e0e0;"></td>'
            : '';
          summaryRows.push(`<tr><td style="padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">Total Amount (Including VAT)</td>${totalRowQuantityCell}<td style="text-align: right; padding: 10px; border-bottom: 1px solid #e0e0e0; font-weight: bold;">£${total.toFixed(2)}</td></tr>`);
        }

        const quantityHeader = hasQuantity
          ? '<th style="text-align: center; padding: 12px; background-color: #f5f5f5; border-bottom: 2px solid #8dc044;">Quantity</th>'
          : '';

        // Create table with only items (no summary rows like VAT, Total, Payment Method)
        // Summary information will be shown in the Payment Details section below
        const itemsOnlyRows = itemRows.join('');

        if (itemsOnlyRows) {
          breakdownTableHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
              <thead>
                <tr>
                  <th style="text-align: left; padding: 12px; background-color: #f5f5f5; border-bottom: 2px solid #8dc044;">Description</th>
                  ${quantityHeader}
                  <th style="text-align: right; padding: 12px; background-color: #f5f5f5; border-bottom: 2px solid #8dc044;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${itemsOnlyRows}
              </tbody>
            </table>`;
        }
      }

      // Calculate discount label and amount for display
      let discountLabel = '';
      let discountAmount = 0;
      let hasDiscount = false;
      let hasAutomaticDiscount = automaticDiscount10Percent > 0;
      let isPerItemDiscount = false;

      if (automaticDiscount10Percent > 0) {
        hasDiscount = true;
        discountLabel = 'Discount (10%)';
        discountAmount = automaticDiscount10Percent;
      }

      if (task.hasDiscount && task.discountType === "perItem" && itemDiscountTotal > 0) {
        hasDiscount = true;
        isPerItemDiscount = true;
        discountLabel = 'Item Discounts';
        discountAmount = itemDiscountTotal;
      } else if (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
        hasDiscount = true;
        discountLabel = `Discount (${task.customDiscountPercent}%)`;
        discountAmount = percentageDiscount;
      }

      // Calculate values for partial payment display
      const depositAmount = task.paidAmount?.amount || 0;
      const remainingAmount = task.remainingAmount?.amount || 0;
      const fullTotalPrice = task.totalPrice || (depositAmount + remainingAmount);

      // Match the same logic as invoice confirmation email
      // isPartialPaid is true if paymentStatus is 'partial_Paid'
      const isPartialPaid = task.paymentStatus === 'partial_Paid';

      // Always show subtotal with original prices (before all discounts)
      const subtotalForDisplay = subtotalBeforeDiscounts;

      // Compile template with Handlebars
      let html;
      try {
        const template = Handlebars.compile(templateSource);
        const templateData = {
          firstName: firstName || '',
          lastName: lastName || '',
          orderNumber: task.orderNumber || orderId,
          total: total.toFixed(2),
          vat: vat.toFixed(2),
          subtotal: subtotalForDisplay.toFixed(2),
          paymentDate: paymentDate || new Date().toLocaleString(),
          paymentType: paymentType || 'Payment',
          paymentMethod: paymentMethod,
          hasDiscount: hasDiscount,
          hasAutomaticDiscount: hasAutomaticDiscount,
          isPerItemDiscount: isPerItemDiscount,
          discountLabel: discountLabel || 'Discount',
          discountAmount: discountAmount.toFixed(2),
          automaticDiscountAmount: automaticDiscount10Percent.toFixed(2),
          itemDiscountAmount: itemDiscountTotal.toFixed(2),
          customDiscountPercent: task.customDiscountPercent || 0,
          isPartialPaid: isPartialPaid,
          depositAmount: depositAmount.toFixed(2),
          remainingAmount: remainingAmount.toFixed(2),
          totalPrice: fullTotalPrice.toFixed(2),
          hasCoupon: couponCode && couponDiscount > 0,
          couponCode: couponCode || '',
          couponPercentage: couponPercentage || 0,
          couponDiscount: couponDiscount.toFixed(2),
        };

        // Log template data for debugging
        console.log('Payment Confirmation Template Data:', {
          isPartialPaid: templateData.isPartialPaid,
          hasDiscount: templateData.hasDiscount,
          orderNumber: templateData.orderNumber,
        });

        html = template(templateData);

        // Verify IMPORTANT NEXT STEPS section is present
        if (!html.includes('IMPORTANT NEXT STEPS')) {
          console.error('❌ ERROR: IMPORTANT NEXT STEPS section missing from compiled HTML!');
          console.log('HTML length:', html.length);
          console.log('HTML snippet around line 529:', html.substring(html.indexOf('Please settle') || 0, (html.indexOf('Please settle') || 0) + 500));
        }
      } catch (error) {
        console.error('❌ ERROR compiling Handlebars template:', error);
        throw error;
      }

      // Note: VAT line is not included in the payment confirmation template for full payments
      // The template already has the correct payment confirmation message

      // Debug: Verify critical sections are present before sending
      const hasHeaderImage = html.includes('header-image') || html.includes('Group_1261156245_ngvccs.png');
      const hasBannerSection = html.includes('payment-banner-container') || html.includes('top-banner');
      const hasGreeting = html.includes('Dear') && !html.includes('{{firstName}}'); // Should have Dear but not the template variable
      const hasPaymentMessage = html.includes("We've successfully received your payment");
      const hasImportantNextSteps = html.includes('IMPORTANT NEXT STEPS') || html.includes('What happens next?');

      if (!hasHeaderImage) {
        console.error('❌ ERROR: Header image section is MISSING from payment confirmation email HTML');
      }
      if (!hasBannerSection) {
        console.error('❌ ERROR: Banner section is MISSING from payment confirmation email HTML');
      }
      if (!hasGreeting) {
        console.error('❌ ERROR: Greeting section is MISSING from payment confirmation email HTML');
      }
      if (!hasPaymentMessage) {
        console.error('❌ ERROR: Payment confirmation message is MISSING from email HTML');
      }
      if (!hasImportantNextSteps) {
        console.error('❌ ERROR: IMPORTANT NEXT STEPS section is MISSING from payment confirmation email HTML');
      }

      // Log HTML structure for debugging if sections are missing
      if (!hasHeaderImage || !hasBannerSection || !hasGreeting || !hasPaymentMessage) {
        const headerIndex = html.indexOf('<!-- Header Image -->');
        const bannerIndex = html.indexOf('<!-- Payment Confirmation Banner Section -->');
        const greetingIndex = html.indexOf('<!-- Greeting -->');
        console.log('HTML structure check:');
        console.log('- Header Image comment index:', headerIndex);
        console.log('- Banner Section comment index:', bannerIndex);
        console.log('- Greeting comment index:', greetingIndex);
        console.log('- HTML length:', html.length);
        console.log('- First 500 chars:', html.substring(0, 500));
      }

      // Send email
      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: addStagingToSubject(`Payment Confirmation - Order #${task.orderNumber}`),
        html: addStagingBanner(html),
        attachments: [{ filename: fileName, path: filePath }],
      });

      // Clean up PDF file
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Error sending payment confirmation email:', error);
      throw error;
    }
  },

  async sendPaymentFailedEmail({ email, firstName, lastName, orderId, amount, currency, paymentType, reason }) {
    try {
      const task = await Task.findById(orderId);
      if (!task) {
        throw new Error(`Task not found with ID: ${orderId}`);
      }

      const safeAmount = typeof amount === 'number' && !isNaN(amount) ? amount.toFixed(2) : 'N/A';
      const safeCurrency = currency || 'GBP';
      const safePaymentType = paymentType || 'Online Payment';
      const displayName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer';

      const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            .section {
              padding: 0;
            }
            .main-table {
              width: 600px;
              max-width: 600px;
            }
            .content-card {
              padding: 40px 48px 42px;
            }
            .content-wrapper {
              padding: 0;
            }
            .inner-content-box {
              padding: 32px;
            }
            @media only screen and (max-width: 620px) {
              .main-table {
                width: 100% !important;
                max-width: 100% !important;
              }
              .content-card {
                padding: 24px !important;
              }
              .hero {
                padding: 0 !important;
              }
              .hero img {
                width: 100% !important;
                max-width: 100% !important;
                display: block !important;
              }
              .content-wrapper {
                padding: 0 16px !important;
              }
              .section:not(.hero) {
                padding: 0 16px 24px !important;
              }
              .thankyou {
                padding: 24px 16px 16px !important;
              }
              .inner-content-box {
                padding: 24px !important;
              }
            }
          </style>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" class="main-table" style="border-collapse: collapse; margin: 0 auto; padding: 0; width: 100%; max-width: 600px; background: #ffffff;">
            <tr>
              <td class="section hero" style="padding: 0; line-height: 0;" align="center">
                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766528514/Group_1261156245_ngvccs.png" alt="London Waste Management" width="600" style="display: block; width: 600px; max-width: 100%; height: auto; margin: 0; border: 0; line-height: 0;" />
              </td>
            </tr>
            <tr>
              <td class="section thankyou" style="padding: 24px 0 16px; text-align: center;">
                <p style="margin: 0; font-size: 26px; font-weight: 700; color: #b91c1c;">
                  <span style="color: #c5f3c3; font-size: 34px;">"</span>
                  Payment Failed
                  <span style="color: #c5f3c3; font-size: 34px;">"</span>
                </p>
              </td>
            </tr>
            <tr>
              <td class="section content-wrapper" style="padding: 0 0 34px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border: none;">
                  <tr>
                    <td class="content-card" style="color: #232b25; background: #ffffff; padding: 40px 48px 42px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="box-shadow: 0 4px 20px rgba(0,0,0,0.12); border-radius: 8px; background: #ffffff;">
                        <tr>
                          <td class="inner-content-box" style="padding: 32px;">
                            <p style="font-size: 22px; font-weight: 700; margin: 0 0 8px;">
                              <span style="color: #000000;">Dear</span>
                              <span style="color: #111111;"> ${displayName},</span>
                            </p>
                            <div style="width: 92px; height: 5px; background: #28c152; margin: 0 0 24px;"></div>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 18px; color: #374237;">
                              Unfortunately, your recent ${safePaymentType} for order <strong>#${task.orderNumber || orderId}</strong> could not be completed.
                            </p>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 18px; color: #374237;">
                              <strong>Amount:</strong> ${safeAmount !== 'N/A' ? `${safeCurrency} ${safeAmount}` : 'N/A'}<br/>
                              <strong>Payment method:</strong> ${safePaymentType}
                            </p>
                            ${reason ? `<p style="font-size: 17px; line-height: 1.8; margin: 0 0 18px; color: #6b7280;"><strong>Reason:</strong><br/>${reason}</p>` : ''}
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 22px; color: #374237;">
                              No money has been taken from your account for this failed attempt. You can try again using the secure payment link we sent you, or choose another payment method.
                            </p>
                            <p style="font-size: 17px; line-height: 1.8; margin: 0 0 22px; color: #374237;">
                              If you continue to experience issues, please contact us at
                              <a href="mailto:hello@londonwastemanagement.com" style="color: #169b4f; text-decoration: none;">hello@londonwastemanagement.com</a>
                              or call us on <a href="tel:02030971517" style="color: #169b4f; text-decoration: none; font-weight: 600;">0203 097 1517</a>.
                            </p>
                            <p style="font-size: 15px; margin: 24px 0 4px; color: #4f5b52;">Kind regards,</p>
                            <p style="font-size: 16px; font-weight: bold; color: #169b4f; margin: 0;">London Waste Management</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 24px; text-align: center; font-size: 12px; color: #5f6b66; border-top: 1px solid #e5f3e1;">
                London Waste Management &nbsp;|&nbsp;
                <a href="mailto:hello@londonwastemanagement.com" style="color: #169b4f; text-decoration: none;">hello@londonwastemanagement.com</a>
              </td>
            </tr>
          </table>
        </body>
      </html>
      `;

      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER, // Send only to responsible email, not to customer
        subject: addStagingToSubject(`Payment Failed - Order #${task.orderNumber || orderId} - Customer: ${email}`),
        html: addStagingBanner(html),
      });
    } catch (error) {
      console.error('Error sending payment failed email:', error);
      // Do not rethrow: payment failure email should not break main flow
    }
  },

  sendRefundEmail,
};

const sendGeneralInvoiceEmail = async ({ responsibleEmail, taskData }) => {
  try {
    const templatePath = path.join(
      __dirname,
      '../public/invoice-template.html',
    );
    let template = fs.readFileSync(templatePath, 'utf8');

    const iconDir = path.join(__dirname, '../public/invoice-icons');

    const asset = (name) => {
      const filePath = path.resolve(iconDir, name);
      // Read file and convert to base64
      const fileBuffer = fs.readFileSync(filePath);
      const base64 = fileBuffer.toString('base64');
      const mimeType = name.endsWith('.png')
        ? 'image/png'
        : name.endsWith('.svg')
          ? 'image/svg+xml'
          : name.endsWith('.ttf')
            ? 'font/ttf'
            : 'image/png';
      return `data:${mimeType};base64,${base64}`;
    };
    console.log("taskData.items", taskData)
    const itemRows = taskData.items
      .map(
        (item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.quantity}</td>
        <td>£${(item.price || 0).toFixed(2)}</td>
        <td>£${(item.discount || 0).toFixed(2)}</td>
        <td>£${(item.objectPosition || 0).toFixed(2)}</td>
        <td>£${(item.positionFee || 0).toFixed(2)}</td>
        <td>£${(item.total || 0).toFixed(2)}</td>
      </tr>`,
      )
      .join('');

    const vars = {
      billingName: `${taskData.firstName} ${taskData.lastName}`,
      email: taskData.email,
      phone: taskData.phoneNumber,
      invoiceNumber: taskData.invoiceNumber,
      orderNumber: taskData.orderNumber,
      invoiceDate: taskData.invoiceDate,
      orderDate: taskData.orderDate,
      serviceDate: new Date(taskData.date).toLocaleDateString('en-GB'),
      available: taskData.available?.replace(/_/g, ' ') || '',
      itemRows,
      subtotal: (taskData.subtotal || 0).toFixed(2),
      vat: (taskData.vat || 0).toFixed(2),
      totalPrice: (taskData.totalPrice || 0).toFixed(2),

      // Asset paths with base64 encoding
      logoPath: asset('london_waste_logo 1.png'),
      bgPath: asset('green-bg.png'),
      locationIcon: asset('location-pin-svgrepo-com 1.png'),
      vatIcon: asset('product-o-svgrepo-com 1.png'),
      emailIcon: asset('email-svgrepo-com 1.png'),
      phoneIcon: asset('phone-svgrepo-com 1.png'),
      calendarIcon: asset('Vector.png'),
      clockIcon: asset('Group 4.png'),
      fontRegular: asset('Lato-Regular.ttf'),
      fontBold: asset('lato-bold.ttf'),
    };

    // Build discount columns for the table header
    let discountColumns = '';
    if (vars.hasDiscount) {
      discountColumns = '<th>Discounted Price</th><th>Discount</th>';
    }
    template = template.replace('{{discountColumns}}', discountColumns);

    // Build discount row for the summary
    let discountRow = '';
    if (vars.hasDiscount) {
      discountRow = `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n        <div><span>${vars.discountLabel} :</span><span>-£${vars.discountAmount}</span></div>`;
    }
    template = template.replace('{{discountRow}}', discountRow);

    // Now do the rest of your variable replacements as before
    for (let key in vars) {
      template = template.replaceAll(`{{${key}}}`, vars[key]);
    }

    // Debug: Save the template to check paths
    fs.writeFileSync(
      path.join(__dirname, '../public/debug-template.html'),
      template,
    );

    // Generate PDF using Playwright
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Set content and wait for network to be idle
    await page.setContent(template, {
      waitUntil: 'networkidle',
      timeout: 30000, // Increase timeout to 30 seconds
    });

    // Wait for images to load
    await page.waitForLoadState('networkidle');

    // Debug: Check if images are loaded
    const imageStatus = await page.evaluate(() => {
      const images = Array.from(document.getElementsByTagName('img'));
      return images.map((img) => ({
        src: img.src.substring(0, 50) + '...', // Truncate base64 string for logging
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }));
    });

    // Generate PDF buffer
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    await context.close();
    await browser.close();

    // Send email with PDF attachment
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: responsibleEmail,
      subject: addStagingToSubject('New Invoice'),
      html: addStagingBanner(`
        <h1>New Invoice</h1>
        <p>Please find attached the invoice for your recent order.</p>
      `),
      attachments: [
        {
          filename: 'invoice.pdf',
          content: pdfBuffer,
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    console.log('Invoice email sent successfully');
  } catch (error) {
    console.error('Error sending invoice email:', error);
    throw error;
  }
};
