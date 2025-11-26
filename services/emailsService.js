// File: emailService.js
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { chromium } = require('playwright');
const PDFDocument = require('pdfkit');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');
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
          ewcCode: 'N/A',
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
    return await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
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
 */
async function sendRefundEmail({ task, paymentHistory, refundAmount }) {
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
    subject: `Refund for Order #${task.orderNumber}`,
    html,
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

    // Calculate subtotal and handle discounts based on discountType
    task.items.forEach((item) => {
      // For custom items, use item.price; for standard items, use standardItemId.price
      const itemPrice = item.standardItemId
        ? (item.standardItemId.price * item.quantity || 0)
        : (item.price * item.quantity || 0);

      const positionPrice =
        item.Objectsposition === 'InsideWithDismantling'
          ? (item.standardItemId?.insideWithDismantlingPrice || 0)
          : item.Objectsposition === 'Inside'
            ? (item.standardItemId?.insidePrice || 0)
            : 0;

      const itemSubtotal = itemPrice + positionPrice;

      // Handle item-specific discount only if hasDiscount is true and discountType is "perItem"
      let finalItemTotal = itemSubtotal;
      if (task.hasDiscount && task.discountType === "perItem" && item.customPrice) {
        finalItemTotal = (item.customPrice * item.quantity) + positionPrice;
      }

      subtotal += finalItemTotal;
    });
    let percentageDiscount = 0;
    // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
    if (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
      percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
      subtotal -= percentageDiscount;
    }

    // Apply 10% discount if task is created by public, all items are 'Outside', and available === 'AnyTime'
    const isAvailableAnyTime = task.available === 'AnyTime';
    const isCreatedByPublic = task.createdByType === 'public';
    const hasItems = task.items && task.items.length > 0;
    const allItemsOutside = hasItems && task.items.every((i) => i.Objectsposition === 'Outside');

    if (isAvailableAnyTime && isCreatedByPublic && hasItems && allItemsOutside) {
      console.log('✅ Applying 10% discount for Outside items with AnyTime and public type in invoice PDF');
      subtotal *= 0.9;
    }

    // Check createdByType condition for minimum price enforcement
    // Only skip minimum price if explicitly 'Admin', otherwise enforce it (for 'public' or undefined/null)
    const enforceMinimumPrice = task.createdByType !== 'Admin';
    console.log('=== INVOICE PDF PRICE CALCULATION ===');
    console.log('task.createdByType:', task.createdByType, 'Type:', typeof task.createdByType);
    console.log('enforceMinimumPrice:', enforceMinimumPrice);
    console.log('subtotal before minimum check:', subtotal);

    // Apply minimum price (before VAT) - if under £37.5, make it £37.5 (=> £45 with VAT)
    if (enforceMinimumPrice && subtotal < 37.5) {
      console.log('Applying minimum price adjustment: £' + subtotal + ' → £37.5');
      subtotal = 37.5;
    } else {
      console.log('Minimum price NOT applied (Admin task or subtotal >= 37.5)');
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

        const positionPrice =
          item.Objectsposition === 'InsideWithDismantling'
            ? (item.standardItemId?.insideWithDismantlingPrice || 0)
            : item.Objectsposition === 'Inside'
              ? (item.standardItemId?.insidePrice || 0)
              : 0;

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
            <td>£${positionPrice.toFixed(2)}</td>
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
            <td>£${positionPrice.toFixed(2)}</td>
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
      subtotal: (subtotal || 0).toFixed(2),
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
        task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0
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
      discountAmount: percentageDiscount.toFixed(2),
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
      depositBadgeUrl: 'https://res.cloudinary.com/dehzhd6xs/image/upload/v1764145006/king_q_2_5_hzeg1b.png',
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
    if (vars.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
      discountRow = `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n        <div><span>${vars.discountLabel} :</span><span>-£${vars.discountAmount}</span></div>`;
    }
    template = template.replace('{{discountRow}}', discountRow);

    // Build refund row for the summary
    let refundRow = '';
    if (isRefund && refundAmount > 0) {
      refundRow = `<hr style="border: 1px solid #8dc044; margin: 10px 0;" />\n        <div class="summary-row"><span class="summary-label">Refunded Amount</span><span class="summary-value">-£${vars.refundAmount}</span></div>`;
    }
    template = template.replace('{{refundRow}}', refundRow);

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
      to: 'soukimahdi@gmail.com',
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
      subject: 'London Waste Management - Customer Review',
      html: htmlContent,
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
                <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1763549850/Group_1261156226_hfpvko.png" alt="London Waste Management" width="600" style="display: block; width: 600px; max-width: 100%; height: auto; margin: 0; border: 0; line-height: 0;" />
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
      subject: 'Thank You for Your Quotation Request',
      html: htmlContent,
    });
  },

  async sendWasteTransferNoteEmail(taskId) {
    const task = await Task.findById(taskId).populate('items.standardItemId');
    if (!task) throw new Error('Task not found');

    const templatePath = path.join(__dirname, '../public/templates/wastenote.html');
    let template = fs.readFileSync(templatePath, 'utf8');

    // Build product rows
    const productRows = task.items.map(item => `
      <div class="bg-white grid grid-cols-3 p-2 border-b border-gray-200">
        <div>${item.standardItemId?.itemName || item.object || 'Unnamed Item'}</div>
        <div class="text-center">${item.quantity || 1}</div>
        <div class="text-right">£${(item.price || item.standardItemId?.price || 0).toFixed(2)}</div>
      </div>
    `).join('');

    // Build EWC codes
    const ewcCodes = task.items
      .filter(i => i.standardItemId?.ewcCode)
      .map(i => `<p><span class="text-[#8bc53f]">${i.standardItemId.ewcCode}</span> : ${i.standardItemId.itemName}</p>`)
      .join('');

    // Replace placeholders
    template = template.replace(/{{firstName}}/g, task.firstName);
    template = template.replace(/{{orderNumber}}/g, task.orderNumber);
    template = template.replace(/{{date}}/g, task.date.toISOString().split('T')[0]);
    template = template.replace(/{{productRows}}/g, productRows);
    template = template.replace(/{{ewcCodes}}/g, ewcCodes || '');
    template = template.replace(/{{collectionAddress}}/g, task.collectionAddress || '');
    template = template.replace(/{{timeSlot}}/g, task.available?.replace(/_/g, ' ') || '');
    template = template.replace(/{{additionalNotes}}/g, task.additionalNotes || 'No additional notes provided.');

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: `Waste Transfer Note for Order #${task.orderNumber}`,
      html: template,
    });
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
      subject: `Invoice for Order #${task.orderNumber}`,
      html: `<p>Please find attached your official invoice for Order #${task.orderNumber}.</p>`,
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

    // Read the CSS file and inline it
    const cssPath = path.join(__dirname, '../public/templates/bookingConfirmation.css');
    const css = fs.readFileSync(cssPath, 'utf8');

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

    // Inline the CSS into the HTML
    const htmlContent = template.replace('</head>', `<style>${css}</style></head>`);

    // Generate invoice PDF
    const dirPath = path.join(__dirname, '../generated');
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
    const fileName = `invoice-${task.orderNumber}.pdf`;
    const filePath = path.join(dirPath, fileName);
    await module.exports.generateOfficialInvoicePDF(task, filePath);

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: `Booking Confirmation - Order #${task.orderNumber}`,
      html: htmlContent,
      attachments: [{ filename: fileName, path: filePath }]
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
      const templatePath = path.join(__dirname, '../public/templates/invoiceConfirmation.html');
      let html = fs.readFileSync(templatePath, 'utf8');

      // Calculate VAT and subtotal from amount
      const total = parseFloat(amount) || 0;
      const subtotal = total / 1.2; // Remove VAT (20%)
      const vat = total - subtotal;

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

      // Handle Handlebars conditionals first
      // Remove discount section if no discount
      if (!task.hasDiscount) {
        html = html.replace(/{{#if hasDiscount}}[\s\S]*?{{\/if}}/g, '');
      } else {
        // Replace discount variables inside the conditional block
        html = html.replace(/{{customDiscountPercent}}/g, (task.customDiscountPercent || 0).toFixed(2));
        const discountAmount = ((subtotal * (task.customDiscountPercent || 0)) / 100).toFixed(2);
        html = html.replace(/{{discountAmount}}/g, discountAmount);
        // Remove only the hasDiscount Handlebars conditional tags but keep the content
        // Remove {{#if hasDiscount}} tag
        html = html.replace(/{{#if hasDiscount}}/g, '');
        // Remove the {{/if}} that belongs to hasDiscount (it's right after the discount row)
        // Match: </tr> followed by {{/if}} (this is the closing tag for hasDiscount)
        html = html.replace(/<\/tr>\s*{{\/if}}/g, '</tr>');
      }

      // Calculate values for partial payment display FIRST (before conditionals)
      const depositAmount = task.paidAmount?.amount || 0;
      const remainingAmount = task.remainingAmount?.amount || 0;
      const fullTotalPrice = task.totalPrice || (depositAmount + remainingAmount);

      // Determine if this is a true partial payment (deposit paid but remaining not paid)
      // OR if both are paid (remaining payment was just completed or full payment)
      const isDepositOnly = task.paymentStatus === 'partial_Paid' &&
        task.paidAmount?.status === 'Paid' &&
        task.remainingAmount?.status === 'Not_Paid';

      const isFullyPaid = task.paymentStatus === 'Paid' ||
        (task.paidAmount?.status === 'Paid' && task.remainingAmount?.status === 'Paid');

      // isPartialPaid is true ONLY if it's a deposit-only payment (not fully paid)
      const isPartialPaid = isDepositOnly && !isFullyPaid;

      if (!isPartialPaid) {
        // For fully paid (including remaining payment): remove {{#if isPartialPaid}}...{{else}}, keep {{else}}...{{/if}} content
        // Match: {{#if isPartialPaid}}...{{else}}...{{/if}} and replace with just the {{else}} content
        html = html.replace(/{{#if isPartialPaid}}[\s\S]*?{{else}}([\s\S]*?){{\/if}}/g, '$1');
        // Also handle any remaining {{#if isPartialPaid}} blocks without {{else}} (message at bottom) - remove them completely
        html = html.replace(/{{#if isPartialPaid}}[\s\S]*?{{\/if}}/g, '');
      } else {
        // For deposit-only payment: process all {{#if isPartialPaid}} blocks
        // First, handle blocks with {{else}} (in table) - keep content before {{else}}, remove {{else}}...{{/if}}
        html = html.replace(/{{#if isPartialPaid}}([\s\S]*?){{else}}[\s\S]*?{{\/if}}/g, '$1');
        // Then, handle remaining blocks without {{else}} (message at bottom) - remove tags but keep content
        // Use a simple regex to match and remove remaining {{#if isPartialPaid}}...{{/if}} blocks
        let iterations = 0;
        let previousHtml = '';
        while (html.includes('{{#if isPartialPaid}}') && html !== previousHtml && iterations < 10) {
          previousHtml = html;
          html = html.replace(/{{#if isPartialPaid}}([\s\S]*?){{\/if}}/g, '$1');
          iterations++;
        }
      }

      // Final cleanup: remove any remaining Handlebars tags for isPartialPaid that might have been missed
      // Remove any remaining {{#if isPartialPaid}} tags
      html = html.replace(/{{#if isPartialPaid}}/g, '');
      // Remove {{else}} tags (these are only for isPartialPaid, hasDiscount doesn't use else)
      html = html.replace(/{{else}}/g, '');
      // Remove remaining {{/if}} tags that are for isPartialPaid
      // Since hasDiscount is processed earlier and its {{/if}} is already removed, 
      // we can safely remove any remaining {{/if}} tags
      html = html.replace(/{{\/if}}/g, '');

      // Replace template variables
      html = html.replace(/{{firstName}}/g, firstName || '');
      html = html.replace(/{{lastName}}/g, lastName || '');
      html = html.replace(/{{orderNumber}}/g, task.orderNumber || orderId);
      html = html.replace(/{{total}}/g, total.toFixed(2));
      html = html.replace(/{{vat}}/g, vat.toFixed(2));
      html = html.replace(/{{subtotal}}/g, subtotal.toFixed(2));
      html = html.replace(/{{paymentDate}}/g, paymentDate || new Date().toLocaleString());
      html = html.replace(/{{paymentType}}/g, paymentType || 'Payment');
      // Partial payment variables - replace these after conditionals are processed
      html = html.replace(/{{depositAmount}}/g, depositAmount.toFixed(2));
      html = html.replace(/{{remainingAmount}}/g, remainingAmount.toFixed(2));
      html = html.replace(/{{totalPrice}}/g, fullTotalPrice.toFixed(2));
      html = html.replace(/{{paymentMethod}}/g, paymentMethod);

      // Update the confirmation message for payment confirmation (after orderNumber is replaced)
      html = html.replace(
        /Thank you for booking with[\s\S]*?<strong style="color: #4caf50">London Waste Management\.<\/strong>/,
        `We've successfully received your payment for Order <strong style="color: #4caf50">#${task.orderNumber || orderId}</strong>. Thank you for choosing <strong style="color: #4caf50">London Waste Management</strong>!`
      );

      // Change title from "Invoice Confirmation" to "Payment Confirmation"
      html = html.replace(/Invoice Confirmation/g, 'Payment Confirmation');

      // Send email
      await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Payment Confirmation - Order #${task.orderNumber}`,
        html: html,
        attachments: [{ filename: fileName, path: filePath }],
      });

      // Clean up PDF file
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Error sending payment confirmation email:', error);
      throw error;
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
      subject: 'New Invoice',
      html: `
        <h1>New Invoice</h1>
        <p>Please find attached the invoice for your recent order.</p>
      `,
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
