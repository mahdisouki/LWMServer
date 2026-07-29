const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const Broker = require('../models/Broker');
const BrokerLead = require('../models/BrokerLead');
const BrokerQuoteRequest = require('../models/BrokerQuoteRequest');
const { User } = require('../models/User');
const { syncTaskQuotationLink } = require('../services/quotationTaskMatchingService');
const { emitNotificationToUser } = require('../socket');

function splitContactName(lead) {
  if (lead.firstName?.trim()) {
    return {
      firstName: lead.firstName.trim(),
      lastName: lead.lastName?.trim() || '-',
    };
  }
  const parts = (lead.contactName || 'Broker Customer').trim().split(/\s+/);
  return {
    firstName: parts[0] || 'Customer',
    lastName: parts.slice(1).join(' ') || '-',
  };
}

function buildAddress(lead, siteAddress) {
  return siteAddress || lead.addressLine1 || lead.companyName || 'Address pending';
}

async function notifyAdmins({ type, message, senderName, metadata }) {
  try {
    const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
    for (const admin of adminUsers) {
      if (admin._id) {
        await emitNotificationToUser(
          admin._id.toString(),
          type,
          message,
          senderName || 'System',
          metadata,
        );
      }
    }
  } catch (error) {
    console.error('notifyAdmins error:', error);
  }
}

async function syncBrokerQuoteToMainSystem({ quote, lead, broker, actorName }) {
  if (quote.mainQuotationId) {
    return QuotationRequest.findById(quote.mainQuotationId);
  }

  const amount = quote.quotedAmount ?? quote.estimatedValue ?? 0;
  const commentParts = [
    quote.description,
    quote.notes,
    quote.wasteType ? `Waste type: ${quote.wasteType}` : '',
    quote.frequency ? `Frequency: ${quote.frequency}` : '',
    `Broker reference: ${quote.referenceCode}`,
  ].filter(Boolean);

  const quotation = await QuotationRequest.create({
    Name: lead.contactName || quote.companyName,
    email: lead.email || 'no-email@broker.local',
    phoneNumber: lead.phone || lead.mobile || '0000000000',
    address: buildAddress(lead, quote.siteAddress),
    postcode: lead.postalCode || 'UNKNOWN',
    estimatedPrices: amount
      ? [{ name: `${quote.companyName} — broker estimate`, price: String(amount) }]
      : [],
    comments: commentParts.join('\n'),
    items: [],
    createdByType: 'broker',
    brokerId: broker._id,
  });

  quote.mainQuotationId = quotation._id;
  await quote.save();

  await notifyAdmins({
    type: 'Quotations',
    message: `New broker quotation from ${broker.companyName} (${quote.referenceCode}) for ${quote.companyName}`,
    senderName: actorName || broker.companyName,
    metadata: {
      type: 'Quotations',
      brokerId: String(broker._id),
      mainQuotationId: String(quotation._id),
    },
  });

  return quotation;
}

async function syncBrokerOrderToMainSystem({ order, lead, broker, actorName }) {
  if (!isOrderVisibleInMainSystem(order.status)) {
    return null;
  }

  if (order.mainTaskId) {
    const existing = await Task.findById(order.mainTaskId);
    if (existing) {
      if (!existing.brokerOrderId) {
        existing.brokerOrderId = order._id;
        await existing.save();
      }
      if (existing.taskStatus === 'Cancelled') {
        existing.taskStatus = 'New';
        existing.reasonForCancellation = '';
        await existing.save();
      }
      return existing;
    }
  }

  const { firstName, lastName } = splitContactName(lead);
  let quotationId = null;

  if (order.quoteRequestId) {
    const brokerQuote = await BrokerQuoteRequest.findById(order.quoteRequestId);
    if (brokerQuote && !brokerQuote.mainQuotationId && brokerQuote.status !== 'Draft') {
      await syncBrokerQuoteToMainSystem({
        quote: brokerQuote,
        lead,
        broker,
        actorName,
      });
    }
    if (brokerQuote?.mainQuotationId) {
      quotationId = brokerQuote.mainQuotationId;
    }
  }

  const orderAmount = Number(order.orderAmount) || 0;
  const itemLabel = [order.wasteType, order.frequency].filter(Boolean).join(' · ') || 'Broker order';

  const task = new Task({
    firstName,
    lastName,
    bussinessName: order.companyName || lead.companyName,
    phoneNumber: lead.phone || lead.mobile || '0000000000',
    email: lead.email || 'no-email@broker.local',
    postcode: lead.postalCode || 'UNKNOWN',
    collectionAddress: buildAddress(lead, order.siteAddress),
    billingAddress: buildAddress(lead, order.siteAddress),
    totalPrice: orderAmount,
    items: orderAmount
      ? [
          {
            object: itemLabel,
            quantity: 1,
            price: orderAmount,
            Objectsposition: 'Outside',
          },
        ]
      : [],
    clientObjectPhotos: [],
    date: order.scheduledAt || new Date(),
    available: 'AnyTime',
    taskStatus: 'New',
    paymentStatus: 'Unpaid',
    paymentMethod: 'cash',
    createdBy: broker.companyName,
    createdByType: 'broker',
    brokerId: broker._id,
    brokerOrderId: order._id,
    quotationId,
    additionalNotes: order.notes || '',
    privateNotes: `Synced from broker order ${order.referenceCode}`,
    priority: (order.priority || 'Medium').toLowerCase(),
  });

  const savedTask = await task.save();

  if (quotationId) {
    try {
      await syncTaskQuotationLink(savedTask);
    } catch (err) {
      console.error('[Broker Sync] quotation link error:', err);
    }
  }

  order.mainTaskId = savedTask._id;
  await order.save();

  await notifyAdmins({
    type: 'Orders',
    message: `New broker order from ${broker.companyName} (${order.referenceCode}) for ${order.companyName} — #${savedTask.orderNumber}`,
    senderName: actorName || broker.companyName,
      metadata: {
      type: 'Orders',
      brokerId: String(broker._id),
      brokerOrderId: String(order._id),
      mainTaskId: String(savedTask._id),
      orderNumber: savedTask.orderNumber,
    },
  });

  return savedTask;
}

const MAIN_SYSTEM_VISIBLE_STATUSES = ['Confirmed', 'InProgress', 'Completed'];

function isOrderVisibleInMainSystem(status) {
  return MAIN_SYSTEM_VISIBLE_STATUSES.includes(status);
}

async function handleBrokerOrderMainSystemVisibility({
  order,
  previousStatus,
  lead,
  broker,
  actorName,
}) {
  const wasVisible = isOrderVisibleInMainSystem(previousStatus);
  const isVisible = isOrderVisibleInMainSystem(order.status);

  if (isVisible && !wasVisible) {
    if (order.mainTaskId) {
      await Task.findByIdAndUpdate(order.mainTaskId, {
        taskStatus: 'New',
        reasonForCancellation: '',
      });
      return;
    }
    if (lead && broker) {
      await syncBrokerOrderToMainSystem({ order, lead, broker, actorName });
    }
    return;
  }

  if (!isVisible && order.mainTaskId) {
    await Task.findByIdAndUpdate(order.mainTaskId, {
      taskStatus: 'Cancelled',
      reasonForCancellation:
        order.status === 'Draft'
          ? 'Broker order moved to draft'
          : 'Broker order cancelled',
    });
  }
}

async function loadBrokerSyncContext(brokerId, leadId) {
  const [broker, lead] = await Promise.all([
    Broker.findById(brokerId).select('companyName contactName email userId brokerCode'),
    BrokerLead.findById(leadId),
  ]);
  if (!broker || !lead) return null;
  return { broker, lead };
}

module.exports = {
  syncBrokerQuoteToMainSystem,
  syncBrokerOrderToMainSystem,
  handleBrokerOrderMainSystemVisibility,
  isOrderVisibleInMainSystem,
  loadBrokerSyncContext,
  notifyAdmins,
};
