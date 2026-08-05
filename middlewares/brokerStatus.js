const { resolveBrokerForUser, isBrokerActiveStatus } = require('../utils/brokerScope');

async function requireActiveBroker(req, res, next) {
  try {
    const broker = await resolveBrokerForUser(req.user);
    if (!broker) {
      return res.status(403).json({
        success: false,
        message: 'No broker profile linked to this account.',
      });
    }

    if (!isBrokerActiveStatus(broker.status)) {
      return res.status(403).json({
        success: false,
        message: 'Broker account is inactive. Please contact support.',
      });
    }

    req.broker = broker;
    return next();
  } catch (error) {
    console.error('requireActiveBroker error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { requireActiveBroker };
