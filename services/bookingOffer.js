const mongoose = require('mongoose');
const BookingHold = require('../models/BookingHold');

const HOLD_MS = 60 * 60 * 1000;
const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;
const ALREADY_CLAIMED_MESSAGE =
  "You've already claimed this offer. Please try again later.";
const TIER_10 = 75;
const TIER_20 = 200;

function isHoldActive(hold) {
  return !hold.usedAt && new Date(hold.expiresAt).getTime() > Date.now();
}

function claimDenial(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return {
    denied: true,
    retryAfterSeconds: Math.max(1, Math.ceil((CLAIM_WINDOW_MS - ageMs) / 1000)),
  };
}

function verifiedTotal(subtotalExVat) {
  const amount = Number(subtotalExVat) || 0;
  return Math.round(amount * 120) / 100;
}

function basketOfferPercent(subtotalExVat) {
  const total = verifiedTotal(subtotalExVat);
  if (total >= TIER_20) return 20;
  if (total >= TIER_10) return 10;
  return 0;
}

function discountPounds(subtotalExVat, { type, value }) {
  const amount = Number(subtotalExVat) || 0;
  const raw = Number(value) || 0;
  if (type === 'percentage') return amount * (raw / 100);
  if (type === 'amount') return Math.min(raw, amount);
  return 0;
}

/**
 * Coupon and basket offer do not stack. Keep the larger saving.
 * Equal amounts keep the basket offer so the hold can be consumed.
 */
function chooseBookingOrCoupon({ subtotal, percent, coupon }) {
  const offerAmount = discountPounds(subtotal, { type: 'percentage', value: percent });
  const couponAmount = coupon
    ? discountPounds(subtotal, {
        type: coupon.discountType,
        value: coupon.discountValue,
      })
    : 0;
  if (couponAmount > offerAmount) return 'coupon';
  if (offerAmount > 0) return 'offer';
  if (couponAmount > 0) return 'coupon';
  return 'none';
}

function serializeHold(hold) {
  const expiresAt = new Date(hold.expiresAt);
  const active = !hold.usedAt && expiresAt.getTime() > Date.now();
  return {
    holdId: String(hold._id),
    startedAt: hold.startedAt,
    expiresAt: hold.expiresAt,
    active,
    used: Boolean(hold.usedAt),
  };
}

async function createOrReuseHold(ip) {
  const latest = await BookingHold.findOne({ ip }).sort({ createdAt: -1 });

  if (latest) {
    if (isHoldActive(latest)) return { hold: latest, created: false };

    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    if (ageMs < CLAIM_WINDOW_MS) return claimDenial(latest.createdAt);
  }

  const startedAt = new Date();
  const hold = await BookingHold.create({
    ip,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + HOLD_MS),
  });

  const earlier = await BookingHold.findOne({
    ip,
    _id: { $ne: hold._id },
    createdAt: { $gte: new Date(Date.now() - CLAIM_WINDOW_MS) },
  }).sort({ createdAt: 1 });

  if (earlier) {
    await BookingHold.deleteOne({ _id: hold._id });
    if (isHoldActive(earlier)) return { hold: earlier, created: false };
    return claimDenial(earlier.createdAt);
  }

  return { hold, created: true };
}

async function getClaimEligibility(ip) {
  const latest = await BookingHold.findOne({ ip }).sort({ createdAt: -1 });
  if (!latest || isHoldActive(latest)) return { canClaim: true };
  const ageMs = Date.now() - new Date(latest.createdAt).getTime();
  if (ageMs < CLAIM_WINDOW_MS) {
    return { canClaim: false, retryAfter: claimDenial(latest.createdAt).retryAfterSeconds };
  }
  return { canClaim: true };
}

async function getHoldForIp(id, ip) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const hold = await BookingHold.findById(id);
  if (!hold || hold.ip !== ip) return null;
  return hold;
}

/**
 * Check a public checkout hold. Does not mark it used.
 * Percent is derived from the server subtotal including 20% VAT.
 */
async function resolveForOrder({ id, ip, subtotal }) {
  if (!ip || ip === 'unknown') {
    return {
      ok: false,
      error: 'OFFER_UNAVAILABLE',
      message: 'Unable to identify client for this offer',
    };
  }

  const hold = await getHoldForIp(id, ip);
  if (!hold) {
    return {
      ok: false,
      error: 'OFFER_NOT_FOUND',
      message: 'This 1-hour basket offer is no longer available. It may have already been used.',
    };
  }
  if (hold.usedAt) {
    return {
      ok: false,
      error: 'OFFER_USED',
      message: 'This 1-hour basket offer has already been used on an order, so it cannot be applied again.',
    };
  }
  if (new Date(hold.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'OFFER_EXPIRED', message: 'Your 1-hour basket offer has expired' };
  }

  return { ok: true, hold, percent: basketOfferPercent(subtotal) };
}

async function claimHold(holdId) {
  return BookingHold.findOneAndUpdate(
    { _id: holdId, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  );
}

async function releaseHold(holdId) {
  await BookingHold.updateOne({ _id: holdId }, { $set: { usedAt: null, taskId: null } });
}

async function attachTask(holdId, taskId) {
  await BookingHold.updateOne({ _id: holdId }, { $set: { taskId } });
}

module.exports = {
  HOLD_MS,
  CLAIM_WINDOW_MS,
  ALREADY_CLAIMED_MESSAGE,
  basketOfferPercent,
  chooseBookingOrCoupon,
  serializeHold,
  createOrReuseHold,
  getClaimEligibility,
  getHoldForIp,
  resolveForOrder,
  claimHold,
  releaseHold,
  attachTask,
};
