const { getRealIP } = require('../middlewares/rateLimiter');
const bookingOffer = require('../services/bookingOffer');

function requireIp(req, res) {
  const ip = getRealIP(req);
  if (!ip || ip === 'unknown') {
    res.status(400).json({ message: 'Unable to identify client for this offer' });
    return null;
  }
  return ip;
}

const bookingHoldCtrl = {
  createBookingHold: async (req, res) => {
    try {
      const ip = requireIp(req, res);
      if (!ip) return undefined;

      const result = await bookingOffer.createOrReuseHold(ip);
      if (result.denied) {
        return res.status(429).json({
          active: false,
          message: bookingOffer.ALREADY_CLAIMED_MESSAGE,
          retryAfter: result.retryAfterSeconds,
        });
      }
      return res.status(result.created ? 201 : 200).json(bookingOffer.serializeHold(result.hold));
    } catch (error) {
      console.error('Error creating booking hold:', error);
      return res.status(500).json({
        message: 'Failed to start the booking offer',
        error: error.message,
      });
    }
  },

  getClaimEligibility: async (req, res) => {
    try {
      const ip = requireIp(req, res);
      if (!ip) return undefined;
      const eligibility = await bookingOffer.getClaimEligibility(ip);
      return res.status(200).json(eligibility);
    } catch (error) {
      console.error('Error checking booking offer eligibility:', error);
      return res.status(500).json({
        message: 'Failed to check the booking offer',
        error: error.message,
      });
    }
  },

  getBookingHold: async (req, res) => {
    try {
      const ip = requireIp(req, res);
      if (!ip) return undefined;

      const hold = await bookingOffer.getHoldForIp(req.params.id, ip);
      if (!hold) {
        return res.status(404).json({
          active: false,
          reason: 'missing',
          message: 'This 1-hour basket offer is no longer available. It may have already been used.',
        });
      }

      const body = bookingOffer.serializeHold(hold);
      if (hold.usedAt) {
        return res.status(200).json({
          ...body,
          active: false,
          reason: 'used',
          message: 'This 1-hour basket offer has already been used on an order, so it cannot be applied again.',
        });
      }
      if (new Date(hold.expiresAt).getTime() <= Date.now()) {
        return res.status(200).json({
          ...body,
          active: false,
          reason: 'expired',
          message: 'Your 1-hour basket offer has expired',
        });
      }

      return res.status(200).json({ ...body, reason: 'active' });
    } catch (error) {
      console.error('Error reading booking hold:', error);
      return res.status(500).json({
        active: false,
        message: 'Failed to check the booking offer',
        error: error.message,
      });
    }
  },
};

module.exports = bookingHoldCtrl;
