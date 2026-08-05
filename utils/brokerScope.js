const Broker = require('../models/Broker');

async function resolveBrokerIdForUser(user) {
  if (user.brokerId) return user.brokerId;
  const broker = await Broker.findOne({ userId: user._id }).select('_id');
  return broker?._id || null;
}

async function resolveBrokerForUser(user) {
  if (user.brokerId) {
    const broker = await Broker.findById(user.brokerId);
    return broker || null;
  }
  const broker = await Broker.findOne({ userId: user._id });
  return broker || null;
}

function isBrokerActiveStatus(status) {
  return String(status || '').toLowerCase() === 'active';
}

module.exports = {
  resolveBrokerIdForUser,
  resolveBrokerForUser,
  isBrokerActiveStatus,
};
