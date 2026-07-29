const nodemailer = require('nodemailer');
const Broker = require('../models/Broker');
const { emitNotificationToUser } = require('../socket');
const { addStagingToSubject, addStagingBanner } = require('../utils/emailHelpers');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

async function notifyBrokerOrg(
  brokerId,
  { type, message, senderName, metadata, emailSubject, emailHtml },
) {
  try {
    const broker = await Broker.findById(brokerId)
      .select('userId email contactName companyName')
      .lean();
    if (!broker) return;

    if (broker.userId) {
      await emitNotificationToUser(
        broker.userId,
        type,
        message,
        senderName || 'System',
        metadata,
      );
    }

    if (broker.email && emailSubject && emailHtml) {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: broker.email,
        subject: addStagingToSubject(emailSubject),
        html: addStagingBanner(emailHtml),
      });
    }
  } catch (error) {
    console.error('notifyBrokerOrg error:', error);
  }
}

module.exports = { notifyBrokerOrg };
