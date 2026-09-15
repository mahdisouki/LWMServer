const {
  upsertTawkLead,
  findMatchingTawkLead,
  clickIdsForResponse,
} = require('../services/tawkAttributionService');

const upsertTawkLeadHandler = async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId || sessionId.length > 80) {
      return res.status(400).json({ message: 'Valid sessionId is required' });
    }

    const lead = await upsertTawkLead(req.body);
    return res.status(200).json({
      ok: true,
      sessionId: lead.sessionId,
    });
  } catch (error) {
    console.error('[Tawk Attribution] upsert failed:', error.message);
    return res.status(500).json({ message: 'Failed to store attribution' });
  }
};

const lookupAttribution = async (req, res) => {
  try {
    const email = req.query.email || req.body?.email;
    const phoneNumber = req.query.phone || req.query.phoneNumber || req.body?.phoneNumber;
    const phoneNumber2 = req.query.phoneNumber2 || req.body?.phoneNumber2;
    const firstName = req.query.firstName || req.body?.firstName;
    const lastName = req.query.lastName || req.body?.lastName;
    const name = req.query.name || req.body?.name;

    const lead = await findMatchingTawkLead({
      email,
      phoneNumber,
      phoneNumber2,
      firstName,
      lastName,
      name,
      createdAt: new Date(),
    });
    if (!lead) {
      return res.status(200).json({ found: false, clickIds: {} });
    }

    return res.status(200).json({
      found: true,
      clickIds: clickIdsForResponse(lead),
      trafficSource: lead.trafficSource || null,
      landingPage: lead.landingPage || null,
    });
  } catch (error) {
    console.error('[Tawk Attribution] lookup failed:', error.message);
    return res.status(500).json({ message: 'Failed to lookup attribution' });
  }
};

module.exports = {
  upsertTawkLeadHandler,
  lookupAttribution,
};
