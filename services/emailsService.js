// File: emailService.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const PDFDocument = require("pdfkit");
const Task = require("../models/Task");
const StandardItem = require("../models/StandardItem");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

function generatePDF(data, filePath) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(25).text("INVOICE", { align: "center" });
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
            name: item.object || "Other item",
            quantity: item.quantity || 1,
            price: item.price || 0,
            ewcCode: "N/A",
          };
        }
  
        const standardItem = await StandardItem.findById(item.standardItemId);
        return {
          name: standardItem?.itemName || "Unnamed Item",
          quantity: item.quantity || 1,
          price: item.price || 0,
          ewcCode: standardItem?.ewcCode || "N/A",
        };
      })
    );
  
    return itemDetails;
  }

async function sendEmail({ to, subject, html, attachments = [] }) {
    try {
        return await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, html, attachments });
    } catch (error) {
        console.log(error);
        throw error;
    }
}

async function loadTaskData(taskId) {
    const task = await Task.findById(taskId).populate('items.standardItemId');
    if (!task) throw new Error("Task not found");
  
    const subtotal = task.totalPrice * 0.8;
    const vat = task.totalPrice * 0.2;
    const paid = task.paidAmount?.amount || 0;
    const balance = task.totalPrice - paid;
  
    const items = task.items.map(i => ({
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
    const refundType = refundAmount < paymentHistory.amount ? 'Partial Refund' : 'Total Refund';
    const remaining = paymentHistory.amount - refundAmount;
    const dirPath = path.join(__dirname, "../generated");
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
    const fileName = `invoice-refund-${task.orderNumber}.pdf`;
    const filePath = path.join(dirPath, fileName);
    await module.exports.generateOfficialInvoicePDF(task, filePath);

    let refundSummary = `<p><strong>Refund Type:</strong> ${refundType}</p>
        <p><strong>Refunded Amount:</strong> £${refundAmount.toFixed(2)}</p>`;
    if (refundType === 'Partial Refund') {
        refundSummary += `<p><strong>Remaining Balance After Refund:</strong> £${remaining.toFixed(2)}</p>`;
    }

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management" style="display:block;margin:auto;"/>
            </div>
            <h2 style="background-color: #e53935; color: white; text-align: center; padding: 10px 0;">Refund Processed</h2>
            <p>Dear ${task.firstName} ${task.lastName},</p>
            <p>Your refund for Order <strong>#${task.orderNumber}</strong> has been processed.</p>
            ${refundSummary}
            <p>Please find your updated invoice attached.</p>
            <p>If you have any questions, feel free to contact us.</p>
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; font-size: 12px; color: #666;">
                <p>London Waste Management | hello@londonwastemanagement.com | 02030971517</p>
            </div>
        </div>
    `;

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
    async  generateOfficialInvoicePDF(task, filePath) {
        const PDFDocument = require('pdfkit');
        const fs = require('fs');
      
        const doc = new PDFDocument({ margin: 50 });
        const writeStream = fs.createWriteStream(filePath);
        doc.pipe(writeStream);
      
        // Company Details
        doc.fontSize(10)
          .text("London Waste Management", 400, 50, { align: "right" })
          .text("6-9 The Square,", { align: "right" })
          .text("Stockley Park,", { align: "right" })
          .text("Heathrow, UB11 1FW,", { align: "right" })
          .text("United Kingdom", { align: "right" })
          .text("VAT registration number: 403 1603 54", { align: "right" });
      
        doc.moveDown(2);
      
        // Invoice Title
        doc.fontSize(16).text("INVOICE", 50, 150);
      
        // Billing & Invoice Details
        doc.fontSize(12)
          .text(`Billing Address:\n${task.firstName} ${task.lastName}\n${task.email || ''}\n${task.phoneNumber || ''}`, 50, 170)
          .text(`Invoice Number: ${task.orderNumber}`, 400, 170)
          .text(`Invoice Date: ${new Date().toISOString().split('T')[0]}`, 400, 185)
          .text(`Order Number: ${task.orderNumber}`, 400, 200)
          .text(`Order Date: ${task.date.toISOString().split('T')[0]}`, 400, 215);
      
        doc.moveDown(2);
      
        // Table Headers
        doc.fillColor('black')
          .rect(50, 250, 500, 20).fill('#000')
          .fillColor('#fff')
          .text('Product', 55, 253)
          .text('Quantity', 355, 253)
          .text('Price', 455, 253);
      
        doc.fillColor('black');
        let y = 275;
      
        // Calculate totals
        let subtotal = 0;
        const items = task.items.map(i => {
            const quantity = i.quantity || 1;
            const price = i.standardItemId ? i.standardItemId.price : i.price || 0;
            const itemTotal = price * quantity;
            subtotal += itemTotal;

            // Add position fees
            let positionFee = 0;
            if (i.Objectsposition === "InsideWithDismantling") {
                positionFee = 18;
            } else if (i.Objectsposition === "Inside") {
                positionFee = 6;
            }
            subtotal += positionFee;

            return {
                name: i.standardItemId?.itemName || i.object || 'Unnamed Item',
                position: i.Objectsposition,
                quantity,
                price: price,
                positionFee,
                total: itemTotal + positionFee
            };
        });
      
        // Print items
        items.forEach(item => {
            doc.text(`${item.name}`, 55, y)
              .text(`${item.quantity}`, 355, y)
              .text(`£${item.price.toFixed(2)}`, 455, y);
            y += 20;

            if (item.positionFee > 0) {
                doc.fontSize(10).text(`${item.position} fee`, 55, y)
                  .text(`£${item.positionFee.toFixed(2)}`, 455, y);
                y += 20;
            }
        });
      
        // Apply discount if applicable
        let discountAmount = 0;
        if (task.customDiscountPercent && task.customDiscountPercent > 0) {
            discountAmount = subtotal * (task.customDiscountPercent / 100);
            subtotal -= discountAmount;
        }
      
        const vat = subtotal * 0.2;
        const total = subtotal + vat;
      
        // Print totals
        y += 10;
        doc.text(`Subtotal`, 400, y).text(`£${(subtotal + discountAmount).toFixed(2)}`, 500, y);
        y += 15;
      
        if (discountAmount > 0) {
            doc.text(`Discount (${task.customDiscountPercent}%)`, 400, y).text(`-£${discountAmount.toFixed(2)}`, 500, y);
            y += 15;
        }
      
        doc.text(`VAT (20%)`, 400, y).text(`£${vat.toFixed(2)}`, 500, y);
        y += 15;
        doc.text(`Total`, 400, y).text(`£${total.toFixed(2)}`, 500, y);
      
        // Payment status
        y += 30;
        const paidAmount = task.paidAmount?.amount || 0;
        const remainingAmount = total - paidAmount;
        
        if (paidAmount > 0) {
            doc.text(`Amount Paid: £${paidAmount.toFixed(2)}`, 50, y);
            y += 15;
            doc.text(`Remaining Balance: £${remainingAmount.toFixed(2)}`, 50, y);
        }
      
        y += 30;
        doc.fontSize(12).text(`Collection Date: ${task.date.toLocaleDateString('en-GB')}`, 50, y);
        y += 15;
        doc.text(`Time Slot: ${task.available.replace(/_/g, ' ')}`, 50, y);
      
        // Footer
        doc.fontSize(10)
          .text("Environment Agency Registered Waste Carrier: CBDU308350", 50, 750, { align: "center" })
          .text("London Waste Management | hello@londonwastemanagement.com | 02030971517", 50, 765, { align: "center" });
      
        doc.end();
      
        return new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
    },
  async sendPartialPaymentNotification(taskId) {
    const data = await Task.findById(taskId).populate('items.standardItemId');
    console.log(data)
    const filePath = `./invoice-${data.orderNumber}.pdf`;
    await generateOfficialInvoicePDF(data, filePath);

    await sendEmail({
      to: "soukimahdi@gmail.com",
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

  async  sendReviewRequestEmail(taskId) {
    const task = await Task.findById(taskId);
    if (!task) throw new Error("Task not found");
  
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
      subject: "London Waste Management - Customer Review",
      html: htmlContent,
    });
  },
  

  async  sendQuoteRequestConfirmationEmail(email) {
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
      subject: "Thank You",
      html: htmlContent,
    });
  },

  async  sendWasteTransferNoteEmail(taskId) {
    const task = await Task.findById(taskId).populate('items.standardItemId');
    console.log(task)
    if (!task) throw new Error("Task not found");
  
    const items = await buildWasteTransferNoteDetails(task);
  
    const productRows = items.map(detail => `
      <tr>
        <td style="border: 1px solid #ccc; padding: 8px;">${detail.name}</td>
        <td style="border: 1px solid #ccc; padding: 8px;">${detail.quantity}</td>
        <td style="border: 1px solid #ccc; padding: 8px;">£${detail.price.toFixed(2)}</td>
      </tr>
    `).join('');
  
    const ewcCodesList = items
      .filter(i => i.ewcCode && i.ewcCode !== "N/A")
      .map(detail => `<li>${detail.ewcCode} : ${detail.name}</li>`)
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
  
          <h3 style="color: #4CAF50;">[Order #${task.orderNumber}] (${task.date.toISOString().split('T')[0]})</h3>
  
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
  
          <p><strong>Note:</strong> ${task.additionalNotes || "No additional notes provided."}</p>
  
          ${ewcCodesList ? `
            <p><strong>EWC Codes:</strong></p>
            <ul style="margin-top: 5px; margin-bottom: 20px; padding-left: 20px;">${ewcCodesList}</ul>
          ` : ''}
  
          <p><strong>Collection Date:</strong> ${task.date.toISOString().split('T')[0]}</p>
          <p><strong>Time Slot:</strong> ${task.available.replace(/_/g, ' ')}</p>
  
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
      subject: "Your London Waste Management order is now complete",
      html: htmlContent,
    });
  },

  async  sendGeneralInvoiceEmail(taskId) {
    const task = await Task.findById(taskId).populate('items.standardItemId');
    if (!task || !task.orderNumber) throw new Error("Invalid task or missing order number");
  
    const dirPath = path.join(__dirname, "../generated");
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
    if (!task) throw new Error("Task not found");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #ddd;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="https://res.cloudinary.com/dfxeaeebv/image/upload/v1742959873/slpany1oqx09lxj72nmd.png" width="150" alt="London Waste Management"/>
        </div>

        <div style="background-color: #8dc044; color: white; padding: 10px; text-align: center; border-radius: 4px;">
          <h2 style="margin: 0;">Booking Confirmation</h2>
        </div>

        <div style="padding: 20px 0;">
          <p>Hi ${task.firstName} ${task.lastName},</p>
          <p>Thank you for booking with London Waste Management.</p>
          <p>We have successfully received your order <strong>#${task.orderNumber}</strong> scheduled on <strong>${task.date.toLocaleDateString('en-GB')}</strong> during <strong>${task.available.replace(/_/g, ' ')}</strong>.</p>
          <p>Collection Address: ${task.collectionAddress}</p>
          <p>If you have any questions, feel free to contact us at <a href="mailto:hello@londonwastemanagement.com">hello@londonwastemanagement.com</a> or call us on 02030971517.</p>
          <p>We look forward to serving you!</p>
        </div>

        <footer style="text-align: center; font-size: 12px; color: #888;">
          <p>London Waste Management | hello@londonwastemanagement.com</p>
        </footer>
      </div>
    `;

    await transporter.sendMail({
      from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
      to: task.email,
      subject: `Booking Confirmation - Order #${task.orderNumber}`,
      html: htmlContent,
    });
  },
  sendRefundEmail
};
