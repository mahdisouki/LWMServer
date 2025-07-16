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
  await module.exports.generateOfficialInvoicePDF(task, filePath);

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
  async generateOfficialInvoicePDF(task, outputPath) {
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
      const itemPrice = item.standardItemId?.price * item.quantity || 0;
      const positionPrice =
        item.Objectsposition === 'InsideWithDismantling'
          ? item.standardItemId?.insideWithDismantlingPrice || 0
          : item.Objectsposition === 'Inside'
          ? item.standardItemId?.insidePrice || 0
          : 0;

      const itemSubtotal = itemPrice + positionPrice;

      // Handle item-specific discount only if hasDiscount is true and discountType is "perItem"
      let finalItemTotal = itemSubtotal;
      if (task.hasDiscount && task.discountType === "perItem" && item.customPrice) {
        finalItemTotal = (item.customPrice * item.quantity) + positionPrice;
      }
      
      subtotal += finalItemTotal;
    });

    // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
    if (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
      const percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
      subtotal -= percentageDiscount;
    }
    
    // Apply minimum price (before VAT) - if under £30, make it £30
    if (subtotal < 30) {
      subtotal = 30;
    }
    
    console.log("subtotal",subtotal)
    vat = subtotal * 0.2;
    total = subtotal + vat;
    
    console.log("task.items", task.items);
    console.log("discountType:", task.discountType);
    console.log("hasDiscount:", task.hasDiscount);
    
    const itemRows = task.items
      .map((item) => {
        const itemPrice = item.standardItemId?.price * item.quantity || 0;
        const positionPrice =
          item.Objectsposition === 'InsideWithDismantling'
            ? item.standardItemId?.insideWithDismantlingPrice || 0
            : item.Objectsposition === 'Inside'
            ? item.standardItemId?.insidePrice || 0
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
        
        if (showDiscountColumn) {
          return `
          <tr>
            <td>${
              item.standardItemId?.itemName || item.object || 'Unnamed Item'
            }</td>
            <td>${item.quantity}</td>
            <td>£${(item.standardItemId?.price || 0).toFixed(2)}</td>
            <td>£${item.customPrice ? discountedPrice.toFixed(2) : (item.standardItemId?.price || 0).toFixed(2)}</td>
            <td>${item.Objectsposition}</td>
            <td>£${positionPrice.toFixed(2)}</td>
            <td>£${finalItemTotal.toFixed(2)}</td>
          </tr>`;
        } else {
          return `
          <tr>
            <td>${
              item.standardItemId?.itemName || item.object || 'Unnamed Item'
            }</td>
            <td>${item.quantity}</td>
            <td>£${(item.standardItemId?.price || 0).toFixed(2)}</td>
            <td>${item.Objectsposition}</td>
            <td>£${positionPrice.toFixed(2)}</td>
            <td>£${finalItemTotal.toFixed(2)}</td>
          </tr>`;
        }
      })
      .join('');

    const vars = {
      billingName: `${task.firstName} ${task.lastName}`,
      billingAddress: task.billingAddress,
      email: task.email,
      phone: task.phoneNumber,
      invoiceNumber: task.orderNumber,
      orderNumber: task.orderNumber,
      invoiceDate: task.createdAt?.toDateString(),
      orderDate: task.date?.toDateString(),
      serviceDate: new Date(task.date).toLocaleDateString('en-GB'),
      available: task.available?.replace(/_/g, ' ') || '',
      itemRows,
      subtotal: (subtotal || 0).toFixed(2),
      vat: (vat || 0).toFixed(2),
      totalPrice: (task.totalPrice || 0).toFixed(2),
      hasDiscount: task.hasDiscount,
      discountType: task.discountType || 'percentage',
      customDiscountPercent: (task.customDiscountPercent || 0).toFixed(2),

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
      discountAmount: task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0
        ? ((subtotal * task.customDiscountPercent) / 100).toFixed(2)
        : '0.00',

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
  
  async sendQuoteRequestConfirmationEmail(email) {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px; background-image:url('https://res.cloudinary.com/ddcsuzef0/image/upload/v1752624279/Group_91_gbbl5x.png');background-size:cover;background-position:center; border: 1px solid #e0e0e0;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management"/>
        </div>
  
        <div style="background-color: rgba(255, 255, 255, 0.5); padding: 30px; border-radius: 10px; text-align: center;border:1px solid green">
          <h2 style="color: #222;">Thank You</h2>
          <p>Hello <a href="mailto:${email}" style="color: #007bff; text-decoration: none;">${email}</a>,</p>
          <p>We have received your quote.</p>
        </div>
      </div>
    `;
  
    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Thank You',
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
    template = template.replace('{{available}}', task.available === 'AnyTime' ? 'anytime (7am to 8pm)' : 
      task.available === '7am-12pm' ? 'morning (7am to 12pm)' :
      task.available === '12pm-5pm' ? 'afternoon (12pm to 5pm)' : task.available);
    template = template.replace('{{collectionAddress}}', task.collectionAddress);
    
    // Inline the CSS into the HTML
    const htmlContent = template.replace('</head>', `<style>${css}</style></head>`);

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: `Booking Confirmation - Order #${task.orderNumber}`,
      html: htmlContent,
    });
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
    console.log("taskData.items",taskData)
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
