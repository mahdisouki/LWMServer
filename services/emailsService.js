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
  const refundType =
    refundAmount < paymentHistory.amount ? 'Partial Refund' : 'Total Refund';
    const remaining = paymentHistory.amount - refundAmount;
  const dirPath = path.join(__dirname, '../generated');
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
    const fileName = `invoice-refund-${task.orderNumber}.pdf`;
    const filePath = path.join(dirPath, fileName);
    await module.exports.generateOfficialInvoicePDF(task, filePath);

    let refundSummary = `<p><strong>Refund Type:</strong> ${refundType}</p>
        <p><strong>Refunded Amount:</strong> £${refundAmount.toFixed(2)}</p>`;
    if (refundType === 'Partial Refund') {
    refundSummary += `<p><strong>Remaining Balance After Refund:</strong> £${remaining.toFixed(
      2,
    )}</p>`;
    }

    const html = `
  <div style=" padding: 40px 0 0; font-family: Arial, sans-serif; text-align: center;">
    <div style="max-width: 90%; margin: auto;  background: #ffffff; border-radius: 12px 12px 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; position: relative; z-index: 2;">
      <div style="padding: 20px 0;">
        <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750544719/uploads/xpi9oph7svpwzmv1dewe.png" width="200" alt="London Waste Management" />
      </div>
  
     <div style="background: linear-gradient(to bottom, #ffffff, #dcedd6);font-weight:bold; color: #444; padding: 20px;text-align: center; font-size: 22px;; border-radius: 0 0 30px 30px;">
${refundType}</div>
    <div style="position: relative; width: 100%;">
    
      <div style="padding: 20px; display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; text-align: left;">
        <div style="flex-shrink: 0; margin-right: 20px; align-self: flex-end;">
    <img 
      src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750615000/uploads/ijxwg07gisqn8d3x3eaz.png" 
      
      style="width: 120px; max-width: 120%; height: auto; margin-top: 330px; " 
    />
            </div>
      <div style="flex: 1; padding-right: 10px;">
          <p style="font-size: 30px;">
  <span style="color: #8DC044; font-weight: bold;">Dear</span>
  <span style="font-weight: bold;">${task.firstName} ${task.lastName},</span>
</p>
<p>We are writing to confirm that a full refund has been issued for your recent payment to London Waste Management</p>
            ${refundSummary}
               <p>The amount has been refunded to your original method of payment and should appear in your account within 3–5 business days.</p>
          <p>We apologise for any inconvenience caused and thank you for your understanding.</p>
  
          <p>If you have any questions or require further assistance, please do not hesitate to contact us at
            <a href="mailto:hello@londonwastemanagement.com" style="color: #007bff;">hello@londonwastemanagement.com</a> or call us on <strong>02030971517</strong>.
          </p>
  
          <p style="margin: 20px 0 5px;">Best regards,</p>
          <p style="color: #6dc24b; font-weight: bold; margin: 0;">London Waste Management Department</p>
        </div>
        <div style="flex-shrink: 0;">
<img 
  src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750610829/uploads/fo5jyq8wjfhoaf2evk6t.png" 
  alt="Truck" 
  style="width: 340px; max-width: 100%; height: auto; border-radius: 4px; margin-left: 40px; margin-top: 190px;" 
/>
        </div>
      </div>
      <div style="padding: 15px 20px; font-size: 12px; text-align: center; color: #666; border-top: 1px solid #eee;">
        London Waste Management |
        <a href="mailto:hello@londonwastemanagement.com" style="color: #007bff;">hello@londonwastemanagement.com</a>
      </div>
    </div>

            </div>
        </div>
    `;
  //shadow image
  // <div style="position: absolute; bottom: 0; left: 0;">
  //       <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750610806/uploads/s4fn4kpglsacaejbfdhg.png" alt="Shadow bottom left" style="max-width: 200px; width: 100%; display: block;" />
  //     </div>

    await transporter.sendMail({
        from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
        to: task.email,
        subject: `${refundType} for Order #${task.orderNumber}`,
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

    // // Handle percentage discount on total only if hasDiscount is true and discountType is "percentage"
    // if (task.hasDiscount && task.discountType === "percentage" && task.customDiscountPercent > 0) {
    //   const percentageDiscount = (subtotal * task.customDiscountPercent) / 100;
    //   subtotal -= percentageDiscount;
    // }
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
        
        if (task.hasDiscount && task.discountType === "perItem") {
          return `
          <tr>
            <td>${
              item.standardItemId?.itemName || item.object || 'Unnamed Item'
            }</td>
            <td>${item.quantity}</td>
            <td>£${(item.standardItemId?.price || 0).toFixed(2)}</td>
            ${task.hasDiscount && task.discountType === "perItem" && item.customPrice ? `<td>£${discountedPrice.toFixed(2)}</td>` : ''}
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
            <td>£${positionPrice.toFixed(2)}</td>
            <td>${item.Objectsposition}</td>
            <td>£${finalItemTotal.toFixed(2)}</td>
          </tr>`;
        }
      })
      .join('');

    const vars = {
      billingName: `${task.firstName} ${task.lastName}`,
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
    if (vars.hasDiscount && task.discountType === "perItem") {
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
      margin: { top: '20px', bottom: '40px', left: '20px', right: '20px' },
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
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px; background-color: #f0f9e8; border: 1px solid #e0e0e0;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management"/>
        </div>
  
        <div style="background-color: #ffffff; padding: 30px; border-radius: 6px; text-align: center;">
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
    console.log(task);
    if (!task) throw new Error('Task not found');
  
    const items = await buildWasteTransferNoteDetails(task);
  
    const productRows = items
      .map(
        (detail) => `
      <tr>
        <td style="border: 1px solid #ccc; padding: 8px;">${detail.name}</td>
        <td style="border: 1px solid #ccc; padding: 8px;">${
          detail.quantity
        }</td>
        <td style="border: 1px solid #ccc; padding: 8px;">£${detail.price.toFixed(
          2,
        )}</td>
      </tr>
    `,
      )
      .join('');
  
    const ewcCodesList = items
      .filter((i) => i.ewcCode && i.ewcCode !== 'N/A')
      .map((detail) => `<li>${detail.ewcCode} : ${detail.name}</li>`)
      .join('');
  
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: auto; padding: 20px; border: 1px solid #ddd;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management"/>
        </div>
  
        <div style="background-color: #8dc044; color: white; padding: 10px; text-align: center; border-radius: 4px;">
          <h2 style="margin: 0;">DUTY OF CARE WASTE TRANSFER NOTE</h2>
        </div>
  
        <div style="padding: 20px;">
          <p>Hi ${task.firstName},</p>
          <p>Your clearance is now complete. This email acts as your Waste Transfer Note.</p>
  
          <h3 style="color: #4CAF50;">[Order #${task.orderNumber}] (${
      task.date.toISOString().split('T')[0]
    })</h3>
  
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 20px;">
            <thead style="background-color: #f2f2f2;">
              <tr>
                <th style="border: 1px solid #ccc; padding: 8px;">Product</th>
                <th style="border: 1px solid #ccc; padding: 8px;">Quantity</th>
                <th style="border: 1px solid #ccc; padding: 8px;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${productRows}
            </tbody>
          </table>
  
          <p><strong>Note:</strong> ${
            task.additionalNotes || 'No additional notes provided.'
          }</p>
  
          ${
            ewcCodesList
              ? `
            <p><strong>EWC Codes:</strong></p>
            <ul style="margin-top: 5px; margin-bottom: 20px; padding-left: 20px;">${ewcCodesList}</ul>
          `
              : ''
          }
  
          <p><strong>Collection Date:</strong> ${
            task.date.toISOString().split('T')[0]
          }</p>
          <p><strong>Time Slot:</strong> ${task.available.replace(
            /_/g,
            ' ',
          )}</p>
  
          <div style="border: 1px solid #ddd; padding: 10px; margin-top: 20px;">
            <h4 style="margin: 0 0 10px 0;">Collection address</h4>
            <p style="margin: 0;">${task.firstName} ${task.lastName}</p>
            <p style="margin: 0;">${task.collectionAddress}</p>
          </div>
  
          <p style="margin-top: 20px; font-size: 12px; color: #777;">
            This Waste Transfer Note has been created by London Waste Management LTD and is valid for one year from the date and time of collection. Please keep this document for your records for a minimum of two years.
            <br/><br/>
            Waste Carrier Licence Number: CBDU308350<br/>
            Business Address: 4 Roundwood Ave, Stockley Park, London, UB11 1AF, United Kingdom.
            <br/><br/>
            For any queries please email us at <a href="mailto:hello@londonwastemanagement.com">hello@londonwastemanagement.com</a> or call us on 02030971517.
          </p>
        </div>
      </div>
    `;
  
    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: 'Your London Waste Management order is now complete',
      html: htmlContent,
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

    const htmlContent = `
      <div style="padding: 40px 0 0; font-family: Arial, sans-serif; text-align: center;background-image: url('https://res.cloudinary.com/ddcsuzef0/image/upload/f_auto,q_auto/i9xnzsb0phuzg96ydjff');background-size: cover;background-position: center;background-repeat: no-repeat;">
  <div style="max-width: 90%; margin: auto; background: #ffffff; border-radius: 12px 12px 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; position: relative; z-index: 2;">
    
    <div style="padding: 20px 0;">
      <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750544719/uploads/xpi9oph7svpwzmv1dewe.png" width="150" alt="London Waste Management" />
        </div>

    <div style="background: linear-gradient(to bottom, #ffffff, #dcedd6); font-weight:bold; color: #222; padding: 20px; text-align: center; font-size: 24px; border-radius: 0 0 30px 30px;">
      Booking confirmation
        </div>

    <div style="padding: 20px; display: flex; flex-direction: row; justify-content: space-between; align-items: flex-start; text-align: left; position: relative; z-index: 2;">

      
      <div style="flex: 1; padding-right: 10px;">
        <p style="font-size: 24px; margin-bottom: 20px;">
          <span style="color: #6dc24b; font-weight: bold;">Hi</span>
          <span style="font-weight: bold;"> ${task.firstName} ${
      task.lastName
    },</span>
        </p>

          <p>Thank you for booking with London Waste Management.</p>

        <p>We have successfully received your order 
          <strong style="color: #00b300;">#${task.orderNumber}</strong> scheduled on 
          <strong>${task.date.toLocaleDateString('en-GB')}</strong> during 
          <strong>${task.available.replace(/_/g, ' ')}</strong>.
        </p>

        <p><strong>Collection Address:</strong> 
          <span style="color: #6dc24b;">${task.collectionAddress}</span>
        </p>

        <p>If you have any question feel free to contact us at 
          <a href="mailto:hello@londonwastemanagement.com" style="color: #007bff;">hello@londonwastemanagement.com</a>
          or call us on <strong>02030971517</strong>.
        </p>

        <p>We look forward to serving you !</p>
        </div>

      <div style="flex-shrink: 0;">
        <img 
          src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1750623581/uploads/kk0rcexpiwluvaaq4xtj.png" 
          alt="Booking Illustration" 
style="width: 260px; max-width: 100%; height: auto; margin-left: 20px; margin-top :75px"         />
      </div>
    </div>

    <div style="padding: 15px 20px; font-size: 12px; text-align: center; color: #666; border-top: 1px solid #eee;">
      London Waste Management |
      <a href="mailto:hello@londonwastemanagement.com" style="color: #007bff;">hello@londonwastemanagement.com</a>
    </div>
  </div>
</div>

    `;

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
      margin: { top: '20px', bottom: '40px', left: '20px', right: '20px' },
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
