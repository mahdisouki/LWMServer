const nodemailer = require('nodemailer');
const { addStagingToSubject, addStagingBanner } = require('./emailHelpers');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

function formatMoney(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return 'N/A';
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '';
  return `${symbol}${Number(amount).toFixed(2)}${symbol ? '' : currency ? ` ${currency}` : ''}`;
}

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

async function sendSubscriptionReminderEmail({
  to,
  adminName,
  subscription,
}) {
  if (!to) return { skipped: true, reason: 'no_email' };

  const name = adminName || 'there';
  const priceLabel = subscription.priceNote
    ? String(subscription.priceNote).replace(/_/g, ' ')
    : formatMoney(subscription.amount, subscription.currency);

  const html = addStagingBanner(`
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #ddd; border-radius: 8px; padding: 24px; background-color: #f9f9f9;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1762522796/omar%27s%20new/Logo_wwspkm.png" alt="London Waste Management" style="max-width: 150px;">
      </div>
      <h2 style="color: #169b4f; text-align: center;">Subscription renewal reminder</h2>
      <p>Hi ${name},</p>
      <p>This is a reminder that the following tool subscription is renewing soon:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #fff;">
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Name</strong></td><td style="padding: 8px; border: 1px solid #eee;">${subscription.name}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Category</strong></td><td style="padding: 8px; border: 1px solid #eee;">${subscription.category || '—'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Renewal date</strong></td><td style="padding: 8px; border: 1px solid #eee;">${formatDate(subscription.nextRenewalDate)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Billing</strong></td><td style="padding: 8px; border: 1px solid #eee;">${subscription.billingFrequency || '—'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Price</strong></td><td style="padding: 8px; border: 1px solid #eee;">${priceLabel}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Login</strong></td><td style="padding: 8px; border: 1px solid #eee;">${subscription.loginEmail || '—'}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #eee;"><strong>Link</strong></td><td style="padding: 8px; border: 1px solid #eee;">${subscription.link ? `<a href="${subscription.link}">${subscription.link}</a>` : '—'}</td></tr>
      </table>
      <p style="font-size: 14px; color: #666;">You are set as the reminder contact for this subscription in the back office.</p>
    </div>
  `);

  await transporter.sendMail({
    from: `"London Waste Management" <${process.env.EMAIL_USER}>`,
    to,
    subject: addStagingToSubject(`Subscription renewal: ${subscription.name}`),
    html,
  });

  return { sent: true };
}

module.exports = { sendSubscriptionReminderEmail };
