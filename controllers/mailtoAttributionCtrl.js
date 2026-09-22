const { upsertMailtoLead } = require('../services/mailtoAttributionService');

const upsertMailtoLeadHandler = async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId || sessionId.length > 80) {
      return res.status(400).json({ message: 'Valid sessionId is required' });
    }

    const lead = await upsertMailtoLead(req.body);
    return res.status(200).json({
      ok: true,
      sessionId: lead.sessionId,
    });
  } catch (error) {
    console.error('[Mailto Attribution] upsert failed:', error.message);
    return res.status(500).json({ message: 'Failed to store mailto attribution' });
  }
};

module.exports = {
  upsertMailtoLeadHandler,
};
