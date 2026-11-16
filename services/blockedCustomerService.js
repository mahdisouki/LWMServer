const BlockedCustomer = require('../models/BlockedCustomer');
const { normalizePhone } = require('./quotationTaskMatchingService');

const PLACEHOLDER_EMAILS = new Set(['no-email@broker.local']);

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || PLACEHOLDER_EMAILS.has(value)) return '';
  return value;
}

function normalizeBlockPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits || digits.length < 9 || /^0+$/.test(digits)) return '';
  return digits;
}

function normalizeAddress(address) {
  const value = String(address || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value || value === 'address pending') return '';
  return value;
}

const UK_POSTCODE = /\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi;

function addressParts(address) {
  const value = normalizeAddress(address).replace(UK_POSTCODE, ' ');
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/,+/g, ',')
    .replace(/^,|,$/g, '')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(',').map((part) => part.trim()).filter(Boolean);
}

function addressesMatch(leftAddress, rightAddress) {
  const left = addressParts(leftAddress);
  const right = addressParts(rightAddress);
  if (!left.length || !right.length) return false;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((part, index) => part === longer[index]);
}

function identityFrom(source) {
  const email = normalizeEmail(source && source.email);
  const phones = [...new Set(
    [source && source.phoneNumber, source && source.phoneNumber2]
      .map(normalizeBlockPhone)
      .filter(Boolean),
  )];
  const address = normalizeAddress(source && source.collectionAddress);
  return { email, phones, address };
}

function hasIdentity(identity) {
  return Boolean(identity.email || identity.phones.length || identity.address);
}

function matchQuery(identity) {
  const ors = [];
  if (identity.email) ors.push({ email: identity.email, active: true });
  if (identity.phones.length) ors.push({ phones: { $in: identity.phones }, active: true });
  if (identity.address) {
    ors.push({ collectionAddressNormalized: identity.address, active: true });
  }
  if (!ors.length) return null;
  return { $or: ors };
}

function matchedOn(identity, block) {
  const labels = [];
  if (identity.email && block.email === identity.email) labels.push('email');
  const storedPhones = Array.isArray(block.phones) ? block.phones : [];
  if (identity.phones.some((phone) => storedPhones.includes(phone))) labels.push('phone');
  if (identity.address && addressesMatch(identity.address, block.collectionAddressNormalized)) {
    labels.push('collection address');
  }
  return labels;
}

function customerName(task) {
  const person = [task && task.firstName, task && task.lastName].filter(Boolean).join(' ').trim();
  return person || (task && task.bussinessName) || 'Customer';
}

function labelsFromIdentity(identity) {
  const labels = [];
  if (identity.email) labels.push('email');
  if (identity.phones.length) labels.push('phone');
  if (identity.address) labels.push('collection address');
  return labels;
}

async function findAddressBlock(address) {
  if (!address) return null;
  const candidates = await BlockedCustomer.find({
    active: true,
    collectionAddressNormalized: { $nin: ['', null] },
  });
  return candidates.find((candidate) => addressesMatch(address, candidate.collectionAddressNormalized)) || null;
}

async function findActiveBlock(source) {
  const identity = identityFrom(source);
  const query = matchQuery(identity);
  const direct = query ? await BlockedCustomer.findOne(query).sort({ createdAt: -1 }) : null;
  const block = direct || await findAddressBlock(identity.address);
  if (!block) return null;
  const labels = matchedOn(identity, block);
  if (!labels.length) return null;
  return { block, matchedOn: labels, identity };
}

function applyBlockedMatch(target, match) {
  if (!match) {
    target.blockedCustomer = false;
    target.blockedMatchOn = [];
    target.blockedReason = '';
    target.blockedCustomerId = null;
    return null;
  }
  target.blockedCustomer = true;
  target.blockedMatchOn = match.matchedOn;
  target.blockedReason = match.block.reason || '';
  target.blockedCustomerId = match.block._id;
  return match;
}

async function notifyAdminsBlockedCustomer(task) {
  if (!task || task.blockedCustomer !== true) return;
  const { emitNotificationToUser, emitRefresh } = require('../socket');
  const { User } = require('../models/User');
  const name = customerName(task);
  const orderRef = task.orderNumber || task._id;
  const reason = String(task.blockedReason || '').trim();
  const message = reason
    ? `Blocked customer — Order #${orderRef} (${name}): ${reason}`
    : `Blocked customer — Order #${orderRef} (${name}). Manual review required.`;
  const date = task.date ? new Date(task.date).toISOString().split('T')[0] : '';
  const metadata = {
    notificationKind: 'blocked_customer',
    taskId: String(task._id),
    orderNumber: task.orderNumber ? String(task.orderNumber) : '',
    matchedOn: task.blockedMatchOn || [],
    createdByType: task.createdByType || '',
    date,
  };
  const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
  for (const admin of adminUsers) {
    if (!admin._id) continue;
    await emitNotificationToUser(admin._id.toString(), 'Orders', message, name, metadata);
  }
  emitRefresh({
    resource: 'tasks',
    action: 'blocked-customer',
    date: date || null,
    meta: { taskId: metadata.taskId, orderNumber: metadata.orderNumber },
  });
}

module.exports = {
  identityFrom,
  hasIdentity,
  labelsFromIdentity,
  findActiveBlock,
  applyBlockedMatch,
  notifyAdminsBlockedCustomer,
  customerName,
};
