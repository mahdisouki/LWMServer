const Fuel = require('../models/Fuel');
const Expense = require('../models/Expense');
const TippingRequest = require('../models/TippingRequest');
const Payroll = require('../models/Payroll');
const Subscription = require('../models/Subscription');
const ManualRunningCost = require('../models/ManualRunningCost');
const {
  COST_CATEGORIES,
  COST_TYPES,
  FEE_FREQUENCIES,
  CATEGORY_META,
} = require('../config/runningCostCategories');

const DIRECT = 'Direct Operational Expenses';
const IT = 'IT';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function daysInclusive(from, to) {
  const ms = endOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.max(1, Math.floor(ms / 86400000) + 1);
}

function daysInMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function parseRange(query = {}) {
  const now = new Date();
  let from = query.from ? new Date(query.from) : startOfDay(now);
  let to = query.to ? new Date(query.to) : endOfDay(now);
  if (Number.isNaN(from.getTime())) from = startOfDay(now);
  if (Number.isNaN(to.getTime())) to = endOfDay(now);
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  return { from: startOfDay(from), to: endOfDay(to) };
}

function prorateSubscription(sub, from, to) {
  const amount = Number(sub.amount) || 0;
  if (amount <= 0 || sub.billingFrequency === 'Free') return 0;

  const periodDays = daysInclusive(from, to);
  const freq = sub.billingFrequency || 'Monthly';

  if (freq === 'One-time') {
    if (!sub.startDate) return 0;
    const start = new Date(sub.startDate);
    return start >= from && start <= to ? amount : 0;
  }
  if (freq === 'Yearly') {
    return round2((amount / 365) * periodDays);
  }
  if (freq === 'Variable') {
    return round2((amount / daysInMonth(from)) * periodDays);
  }
  // Monthly default
  return round2((amount / daysInMonth(from)) * periodDays);
}

function mapRunningCategory(raw) {
  if (COST_CATEGORIES.includes(raw)) return raw;
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('it') || lower.includes('software') || lower.includes('saas')) {
    return IT;
  }
  return DIRECT;
}

async function buildSyncedLines(from, to) {
  const lines = [];

  const [fuels, expenses, tippings, payrolls, subscriptions] = await Promise.all([
    Fuel.find({
      $or: [
        { date: { $gte: from, $lte: to } },
        { time: { $gte: from, $lte: to } },
      ],
    }).lean(),
    Expense.find({
      $or: [
        { date: { $gte: from, $lte: to } },
        { time: { $gte: from, $lte: to } },
      ],
    }).lean(),
    TippingRequest.find({
      tipdate: { $gte: from, $lte: to },
      price: { $gt: 0 },
    }).lean(),
    Payroll.find({
      startTime: { $gte: from, $lte: to },
      totalSalary: { $gt: 0 },
    })
      .populate('userId', 'roleType username firstName lastName')
      .lean(),
    Subscription.find({ status: 'Active' }).lean(),
  ]);

  const fuelTotal = round2(fuels.reduce((s, f) => s + (Number(f.amount) || 0), 0));
  if (fuelTotal > 0) {
    lines.push({
      id: 'synced-fuel',
      source: 'fuel',
      name: 'Fuel',
      description: `${fuels.length} record(s)`,
      amount: fuelTotal,
      category: DIRECT,
      costType: 'Variable',
      synced: true,
      linkPath: '/dashboard/fuel-records',
      meta: CATEGORY_META[DIRECT],
    });
  }

  const expenseTotal = round2(
    expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
  );
  if (expenseTotal > 0) {
    lines.push({
      id: 'synced-expenses',
      source: 'expenses',
      name: 'Driver expenses',
      description: `${expenses.length} expense(s)`,
      amount: expenseTotal,
      category: DIRECT,
      costType: 'Variable',
      synced: true,
      linkPath: '/dashboard/expenses',
      meta: CATEGORY_META[DIRECT],
    });
  }

  const tippingTotal = round2(
    tippings.reduce((s, t) => s + (Number(t.price) || 0), 0),
  );
  if (tippingTotal > 0) {
    lines.push({
      id: 'synced-tipping',
      source: 'tipping',
      name: 'Tipping site fees',
      description: `${tippings.length} load(s)`,
      amount: tippingTotal,
      category: DIRECT,
      costType: 'Variable',
      synced: true,
      linkPath: '/dashboard/tipping',
      meta: CATEGORY_META[DIRECT],
    });
  }

  let driverSalary = 0;
  let helperSalary = 0;
  let driverCount = 0;
  let helperCount = 0;
  let driverHours = 0;
  let helperHours = 0;

  for (const p of payrolls) {
    const role = p.userId?.roleType;
    const salary = Number(p.totalSalary) || 0;
    const hours = Number(p.totalHoursWorked) || 0;
    if (role === 'Helper') {
      helperSalary += salary;
      helperCount += 1;
      helperHours += hours;
    } else {
      driverSalary += salary;
      driverCount += 1;
      driverHours += hours;
    }
  }

  driverSalary = round2(driverSalary);
  helperSalary = round2(helperSalary);
  driverHours = round2(driverHours);
  helperHours = round2(helperHours);

  if (driverSalary > 0) {
    lines.push({
      id: 'synced-driver-wages',
      source: 'payroll',
      name: 'Driver wages',
      description: `${driverCount} shift(s) · ${driverHours} hrs`,
      amount: driverSalary,
      category: DIRECT,
      costType: 'Variable',
      synced: true,
      linkPath: '/dashboard/payroll',
      meta: CATEGORY_META[DIRECT],
    });
  }
  if (helperSalary > 0) {
    lines.push({
      id: 'synced-helper-wages',
      source: 'payroll',
      name: 'Loaders & helpers',
      description: `${helperCount} shift(s) · ${helperHours} hrs`,
      amount: helperSalary,
      category: DIRECT,
      costType: 'Variable',
      synced: true,
      linkPath: '/dashboard/payroll',
      meta: CATEGORY_META[DIRECT],
    });
  }

  for (const sub of subscriptions) {
    const prorated = prorateSubscription(sub, from, to);
    if (prorated <= 0) continue;
    const category = mapRunningCategory(sub.category) || IT;
    const costType = COST_TYPES.includes(sub.costType) ? sub.costType : 'Fixed';
    lines.push({
      id: `synced-sub-${sub._id}`,
      source: 'subscription',
      sourceId: String(sub._id),
      name: sub.name,
      description: `${sub.billingFrequency || 'Monthly'} · period share`,
      amount: prorated,
      category,
      costType,
      synced: true,
      linkPath: '/dashboard/subscriptions',
      meta: CATEGORY_META[category] || CATEGORY_META[IT],
    });
  }

  return lines;
}

function frequencyLabel(doc) {
  if (doc.frequency === 'Custom') return `every ${doc.customDays} days`;
  return doc.frequency;
}

function periodShare(doc, from, to) {
  const stored = Number(doc.amount) || 0;
  if (!doc.frequency) {
    const date = new Date(doc.date);
    if (date < from || date > to) return null;
    return { amount: round2(stored), description: doc.note || '' };
  }

  const activeFrom = startOfDay(doc.startDate || doc.date);
  const activeTo = doc.endDate ? endOfDay(doc.endDate) : to;
  const overlapFrom = activeFrom > from ? activeFrom : from;
  const overlapTo = activeTo < to ? activeTo : to;
  if (overlapFrom > overlapTo) return null;

  const days = daysInclusive(overlapFrom, overlapTo);
  let share;
  if (doc.frequency === 'Daily') share = stored * days;
  else if (doc.frequency === 'Weekly') share = (stored / 7) * days;
  else if (doc.frequency === 'Monthly') share = (stored / daysInMonth(overlapFrom)) * days;
  else if (doc.frequency === 'Custom') {
    const cycle = Number(doc.customDays);
    if (!Number.isInteger(cycle) || cycle < 1) {
      const error = new Error(
        `Manual cost ${doc._id} has custom frequency without a day count`,
      );
      error.statusCode = 500;
      throw error;
    }
    share = (stored / cycle) * days;
  } else {
    const error = new Error(
      `Manual cost ${doc._id} has unknown frequency ${doc.frequency}`,
    );
    error.statusCode = 500;
    throw error;
  }

  const note = doc.note ? `${doc.note} · ` : '';
  return {
    amount: round2(share),
    description: `${note}${frequencyLabel(doc)} · period share`,
  };
}

function readRecurrence(body, fallbackDate) {
  const frequencyRaw = String(body.frequency || '').trim();
  if (!frequencyRaw) {
    return { frequency: null, customDays: null, startDate: null, endDate: null };
  }
  if (!FEE_FREQUENCIES.includes(frequencyRaw)) {
    return { error: 'Invalid frequency' };
  }

  const startDate = body.startDate ? new Date(body.startDate) : new Date(fallbackDate);
  if (Number.isNaN(startDate.getTime())) return { error: 'Invalid start date' };

  let endDate = null;
  if (body.endDate) {
    endDate = new Date(body.endDate);
    if (Number.isNaN(endDate.getTime())) return { error: 'Invalid end date' };
    if (startOfDay(endDate) < startOfDay(startDate)) {
      return { error: 'End date must be on or after the start date' };
    }
  }

  let customDays = null;
  if (frequencyRaw === 'Custom') {
    customDays = Number(body.customDays);
    if (!Number.isInteger(customDays) || customDays < 1) {
      return { error: 'Custom frequency requires a whole number of days' };
    }
  }

  return { frequency: frequencyRaw, customDays, startDate, endDate };
}

function mapManual(doc, range) {
  const category = doc.category;
  const share = range
    ? periodShare(doc, range.from, range.to)
    : { amount: round2(doc.amount), description: doc.note || '' };
  if (!share) return null;
  return {
    id: String(doc._id),
    source: 'manual',
    sourceId: String(doc._id),
    name: doc.name,
    description: share.description,
    amount: share.amount,
    cycleAmount: round2(doc.amount),
    frequency: doc.frequency || null,
    customDays: doc.customDays || null,
    startDate: doc.startDate || null,
    endDate: doc.endDate || null,
    category,
    costType: doc.costType,
    synced: false,
    date: doc.date,
    note: doc.note || '',
    receiptUrl: doc.receiptUrl || null,
    linkPath: null,
    meta: CATEGORY_META[category] || CATEGORY_META[DIRECT],
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

exports.getSummary = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const synced = await buildSyncedLines(from, to);
    const manuals = await ManualRunningCost.find({
      $or: [
        {
          frequency: { $in: FEE_FREQUENCIES },
          $or: [
            { startDate: { $lte: to } },
            { startDate: null, date: { $lte: to } },
          ],
        },
        {
          frequency: null,
          date: { $gte: from, $lte: to },
        },
      ],
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const manualLines = manuals
      .map((doc) => mapManual(doc, { from, to }))
      .filter(Boolean);
    const syncedTotal = round2(synced.reduce((s, l) => s + l.amount, 0));
    const manualTotal = round2(manualLines.reduce((s, l) => s + l.amount, 0));
    const fixedTotal = round2(
      [...synced, ...manualLines]
        .filter((l) => l.costType === 'Fixed')
        .reduce((s, l) => s + l.amount, 0),
    );
    const variableTotal = round2(
      [...synced, ...manualLines]
        .filter((l) => l.costType === 'Variable')
        .reduce((s, l) => s + l.amount, 0),
    );

    return res.json({
      from,
      to,
      categories: COST_CATEGORIES,
      costTypes: COST_TYPES,
      frequencies: FEE_FREQUENCIES,
      categoryMeta: CATEGORY_META,
      synced,
      manual: manualLines,
      totals: {
        synced: syncedTotal,
        manual: manualTotal,
        fixed: fixedTotal,
        variable: variableTotal,
        all: round2(syncedTotal + manualTotal),
        syncedCount: synced.length,
        manualCount: manualLines.length,
        lineCount: synced.length + manualLines.length,
      },
    });
  } catch (error) {
    console.error('runningCosts.getSummary', error);
    return res.status(500).json({
      message: 'Failed to load running costs',
      error: error.message,
    });
  }
};

exports.createManual = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const amount = Number(req.body.amount);
    const category = String(req.body.category || '').trim();
    const costType = String(req.body.costType || 'Variable').trim();
    const note = String(req.body.note || '').trim();
    const date = req.body.date ? new Date(req.body.date) : new Date();

    if (!name) return res.status(400).json({ message: 'Name is required' });
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }
    if (!COST_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }
    if (!COST_TYPES.includes(costType)) {
      return res.status(400).json({ message: 'Invalid cost type' });
    }
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const recurrence = readRecurrence(req.body, date);
    if (recurrence.error) {
      return res.status(400).json({ message: recurrence.error });
    }

    const receiptUrl = req.file?.path || req.body.receiptUrl || null;

    const doc = await ManualRunningCost.create({
      name,
      amount,
      category,
      costType,
      date: recurrence.startDate || date,
      frequency: recurrence.frequency,
      customDays: recurrence.customDays,
      startDate: recurrence.startDate,
      endDate: recurrence.endDate,
      note,
      receiptUrl,
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      message: 'Manual cost created',
      item: mapManual(doc.toObject()),
    });
  } catch (error) {
    console.error('runningCosts.createManual', error);
    return res.status(500).json({
      message: 'Failed to create manual cost',
      error: error.message,
    });
  }
};

exports.updateManual = async (req, res) => {
  try {
    const doc = await ManualRunningCost.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Manual cost not found' });

    if (req.body.name !== undefined) doc.name = String(req.body.name).trim();
    if (req.body.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ message: 'Valid amount is required' });
      }
      doc.amount = amount;
    }
    if (req.body.category !== undefined) {
      const category = String(req.body.category).trim();
      if (!COST_CATEGORIES.includes(category)) {
        return res.status(400).json({ message: 'Invalid category' });
      }
      doc.category = category;
    }
    if (req.body.costType !== undefined) {
      const costType = String(req.body.costType).trim();
      if (!COST_TYPES.includes(costType)) {
        return res.status(400).json({ message: 'Invalid cost type' });
      }
      doc.costType = costType;
    }
    if (req.body.note !== undefined) doc.note = String(req.body.note).trim();
    if (req.body.date !== undefined) {
      const date = new Date(req.body.date);
      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({ message: 'Invalid date' });
      }
      doc.date = date;
    }
    if (
      req.body.frequency !== undefined ||
      req.body.customDays !== undefined ||
      req.body.startDate !== undefined ||
      req.body.endDate !== undefined
    ) {
      const recurrence = readRecurrence(
        {
          frequency: req.body.frequency !== undefined ? req.body.frequency : doc.frequency,
          customDays: req.body.customDays !== undefined ? req.body.customDays : doc.customDays,
          startDate: req.body.startDate !== undefined ? req.body.startDate : doc.startDate,
          endDate: req.body.endDate !== undefined ? req.body.endDate : doc.endDate,
        },
        doc.date,
      );
      if (recurrence.error) {
        return res.status(400).json({ message: recurrence.error });
      }
      doc.frequency = recurrence.frequency;
      doc.customDays = recurrence.customDays;
      doc.startDate = recurrence.startDate;
      doc.endDate = recurrence.endDate;
      if (recurrence.startDate) doc.date = recurrence.startDate;
    }
    if (req.file?.path) doc.receiptUrl = req.file.path;
    else if (req.body.receiptUrl !== undefined) {
      doc.receiptUrl = req.body.receiptUrl || null;
    }

    await doc.save();
    return res.json({
      message: 'Manual cost updated',
      item: mapManual(doc.toObject()),
    });
  } catch (error) {
    console.error('runningCosts.updateManual', error);
    return res.status(500).json({
      message: 'Failed to update manual cost',
      error: error.message,
    });
  }
};

exports.deleteManual = async (req, res) => {
  try {
    const doc = await ManualRunningCost.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Manual cost not found' });
    return res.json({ message: 'Manual cost deleted' });
  } catch (error) {
    console.error('runningCosts.deleteManual', error);
    return res.status(500).json({
      message: 'Failed to delete manual cost',
      error: error.message,
    });
  }
};

exports.getMeta = async (_req, res) => {
  return res.json({
    categories: COST_CATEGORIES,
    costTypes: COST_TYPES,
    frequencies: FEE_FREQUENCIES,
    categoryMeta: CATEGORY_META,
  });
};
