const Admin = require('../models/Admin');
const { getGmailAuth } = require('./gmailAuthHelper');

function getTopicName() {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) {
    throw new Error(
      'GMAIL_PUBSUB_TOPIC environment variable is not set. ' +
        'Expected format: projects/<project-id>/topics/<topic-name>'
    );
  }
  return topic;
}

async function startWatch(adminId) {
  const topicName = getTopicName();
  const gmail = await getGmailAuth(adminId);

  const profile = await gmail.users.getProfile({ userId: 'me' });
  const emailAddress = profile.data.emailAddress;
  const currentHistoryId = profile.data.historyId;

  const response = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds: ['INBOX'],
      labelFilterAction: 'include',
    },
  });

  const newHistoryId = response.data.historyId || currentHistoryId;
  const expiration = response.data.expiration
    ? Number(response.data.expiration)
    : null;

  await Admin.findByIdAndUpdate(adminId, {
    gmailEmailAddress: emailAddress,
    gmailHistoryId: newHistoryId,
    gmailWatchExpiry: expiration,
  });

  console.log(
    `[Gmail Watch] Started for ${emailAddress} (admin ${adminId}). Expires at ${
      expiration ? new Date(expiration).toISOString() : 'unknown'
    }`
  );

  return {
    emailAddress,
    historyId: newHistoryId,
    expiration,
  };
}

async function stopWatch(adminId) {
  try {
    const gmail = await getGmailAuth(adminId);
    await gmail.users.stop({ userId: 'me' });
    await Admin.findByIdAndUpdate(adminId, { gmailWatchExpiry: null });
    console.log(`[Gmail Watch] Stopped for admin ${adminId}`);
    return true;
  } catch (error) {
    console.warn(`[Gmail Watch] Stop failed for admin ${adminId}:`, error.message);
    return false;
  }
}

// Renew watches that are close to expiring (within RENEW_THRESHOLD_MS).
// Gmail watch lasts max 7 days; we renew well before to be safe.
async function renewAllWatches() {
  const RENEW_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day before expiry
  const now = Date.now();

  const admins = await Admin.find({
    'gmailTokens.access_token': { $exists: true, $ne: null },
  }).select('_id gmailWatchExpiry');

  for (const admin of admins) {
    const adminId = admin._id.toString();
    const expiry = admin.gmailWatchExpiry;

    const needsStart = !expiry;
    const needsRenew = expiry && expiry - now < RENEW_THRESHOLD_MS;

    if (!needsStart && !needsRenew) continue;

    try {
      await startWatch(adminId);
    } catch (error) {
      console.error(
        `[Gmail Watch] Renew failed for admin ${adminId}:`,
        error.message
      );
    }
  }
}

module.exports = {
  startWatch,
  stopWatch,
  renewAllWatches,
};
