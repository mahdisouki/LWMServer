const Subscription = require('../models/Subscription');
const Admin = require('../models/Admin');

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizePriceNote(value) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (['free', 'ask_ads_team', 'approx'].includes(v)) return v;
  return null;
}

function normalizeCurrency(value) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim().toUpperCase();
  if (['USD', 'GBP'].includes(v)) return v;
  return null;
}

function buildPayload(body = {}, { partial = false } = {}) {
  const payload = {};
  const set = (key, val) => {
    if (!partial || body[key] !== undefined) payload[key] = val;
  };

  if (!partial || body.name !== undefined) {
    payload.name = String(body.name || '').trim();
  }
  set('description', body.description != null ? String(body.description).trim() : '');
  set('loginEmail', body.loginEmail != null ? String(body.loginEmail).trim().toLowerCase() : '');
  set('link', body.link != null ? String(body.link).trim() : '');
  set('category', body.category != null ? String(body.category).trim() : '');

  if (!partial || body.amount !== undefined) {
    payload.amount = parseOptionalNumber(body.amount);
  }
  if (!partial || body.currency !== undefined) {
    payload.currency = normalizeCurrency(body.currency);
  }
  if (!partial || body.priceNote !== undefined) {
    payload.priceNote = normalizePriceNote(body.priceNote);
  }
  if (!partial || body.billingFrequency !== undefined) {
    const freq = String(body.billingFrequency || 'Monthly');
    payload.billingFrequency = Subscription.BILLING_FREQUENCIES.includes(freq)
      ? freq
      : 'Monthly';
  }
  if (!partial || body.status !== undefined) {
    const status = String(body.status || 'Active');
    payload.status = Subscription.STATUSES.includes(status) ? status : 'Active';
  }

  if (!partial || body.startDate !== undefined) {
    payload.startDate = parseOptionalDate(body.startDate);
  }
  if (!partial || body.nextRenewalDate !== undefined) {
    payload.nextRenewalDate = parseOptionalDate(body.nextRenewalDate);
  }
  if (!partial || body.remindDaysBefore !== undefined) {
    const days = parseOptionalNumber(body.remindDaysBefore);
    payload.remindDaysBefore = days == null ? 7 : Math.max(0, Math.floor(days));
  }
  if (!partial || body.reminderAdminId !== undefined) {
    payload.reminderAdminId = body.reminderAdminId || null;
  }

  set('owner', body.owner != null ? String(body.owner).trim() : '');
  set('notes', body.notes != null ? String(body.notes).trim() : '');
  set(
    'passwordVaultLink',
    body.passwordVaultLink != null ? String(body.passwordVaultLink).trim() : '',
  );

  return payload;
}

const subscriptionCtrl = {
  list: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        keyword,
        status,
        category,
        billingFrequency,
        dueSoon,
        sort = '-nextRenewalDate',
      } = req.query;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const skip = (pageNum - 1) * limitNum;

      const filter = {};
      if (status && Subscription.STATUSES.includes(status)) {
        filter.status = status;
      }
      if (category && String(category).trim()) {
        filter.category = String(category).trim();
      }
      if (
        billingFrequency &&
        Subscription.BILLING_FREQUENCIES.includes(billingFrequency)
      ) {
        filter.billingFrequency = billingFrequency;
      }
      if (keyword && String(keyword).trim()) {
        const re = new RegExp(String(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [
          { name: re },
          { description: re },
          { loginEmail: re },
          { category: re },
          { owner: re },
        ];
      }
      if (dueSoon === 'true' || dueSoon === '1') {
        const now = new Date();
        const in30 = new Date(now);
        in30.setDate(in30.getDate() + 30);
        filter.status = filter.status || 'Active';
        filter.nextRenewalDate = { $gte: now, $lte: in30 };
      }

      const [total, subscriptions, categories] = await Promise.all([
        Subscription.countDocuments(filter),
        Subscription.find(filter)
          .populate('reminderAdminId', 'username email firstName lastName')
          .populate('createdBy', 'username email')
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Subscription.distinct('category', { category: { $nin: [null, ''] } }),
      ]);

      res.status(200).json({
        message: 'Subscriptions retrieved successfully',
        subscriptions,
        categories: categories.sort((a, b) => a.localeCompare(b)),
        meta: {
          currentPage: pageNum,
          limit: limitNum,
          total,
          count: subscriptions.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to list subscriptions',
        error: error.message,
      });
    }
  },

  getById: async (req, res) => {
    try {
      const subscription = await Subscription.findById(req.params.id)
        .populate('reminderAdminId', 'username email firstName lastName')
        .populate('createdBy', 'username email');
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      res.status(200).json({
        message: 'Subscription retrieved successfully',
        subscription,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get subscription',
        error: error.message,
      });
    }
  },

  create: async (req, res) => {
    try {
      const payload = buildPayload(req.body, { partial: false });
      if (!payload.name) {
        return res.status(400).json({ message: 'Name is required' });
      }
      payload.createdBy = req.user?._id || null;

      const subscription = await Subscription.create(payload);
      const populated = await Subscription.findById(subscription._id)
        .populate('reminderAdminId', 'username email firstName lastName')
        .populate('createdBy', 'username email');

      res.status(201).json({
        message: 'Subscription created successfully',
        subscription: populated,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to create subscription',
        error: error.message,
      });
    }
  },

  update: async (req, res) => {
    try {
      const payload = buildPayload(req.body, { partial: true });
      if (payload.name !== undefined && !payload.name) {
        return res.status(400).json({ message: 'Name cannot be empty' });
      }

      const subscription = await Subscription.findByIdAndUpdate(
        req.params.id,
        { $set: payload },
        { new: true, runValidators: true },
      )
        .populate('reminderAdminId', 'username email firstName lastName')
        .populate('createdBy', 'username email');

      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }

      res.status(200).json({
        message: 'Subscription updated successfully',
        subscription,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update subscription',
        error: error.message,
      });
    }
  },

  remove: async (req, res) => {
    try {
      const subscription = await Subscription.findByIdAndDelete(req.params.id);
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      res.status(200).json({ message: 'Subscription deleted successfully' });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete subscription',
        error: error.message,
      });
    }
  },

  listReminderAdmins: async (req, res) => {
    try {
      const admins = await Admin.find({})
        .select('username email firstName lastName')
        .sort({ username: 1 })
        .lean();
      res.status(200).json({
        message: 'Reminder admins retrieved successfully',
        admins,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to list reminder admins',
        error: error.message,
      });
    }
  },
};

module.exports = subscriptionCtrl;
