/**
 * Microsoft Advertising offline conversions (ApplyOfflineConversions REST).
 *
 * Only uploads to the existing Offline goal: quote-to-purchase
 * (Paid orders linked to a quotation that have an msclkid).
 *
 * The Event goal "Purchase" is UET-only and is not used here.
 *
 * Env:
 *   MICROSOFT_ADS_CONVERSIONS_ENABLED=true
 *   MICROSOFT_ADS_DEVELOPER_TOKEN
 *   MICROSOFT_ADS_CUSTOMER_ID
 *   MICROSOFT_ADS_ACCOUNT_ID
 *   MICROSOFT_ADS_CLIENT_ID
 *   MICROSOFT_ADS_CLIENT_SECRET
 *   MICROSOFT_ADS_REFRESH_TOKEN
 *   MICROSOFT_ADS_OFFLINE_CONVERSION_NAME=quote-to-purchase (optional)
 */
const axios = require('axios');
const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');
const PaymentHistory = require('../models/PaymentHistory');

const CURRENCY = 'GBP';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const APPLY_URL =
  'https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/OfflineConversions/Apply';
const SCOPES = 'https://ads.microsoft.com/msads.manage offline_access';

function isEnabled() {
  return process.env.MICROSOFT_ADS_CONVERSIONS_ENABLED === 'true';
}

function getConversionName() {
  return process.env.MICROSOFT_ADS_OFFLINE_CONVERSION_NAME || 'quote-to-purchase';
}

function getAccountId() {
  return String(process.env.MICROSOFT_ADS_ACCOUNT_ID || '').trim();
}

function getCustomerId() {
  return String(process.env.MICROSOFT_ADS_CUSTOMER_ID || '').trim();
}

function getDeveloperToken() {
  return String(process.env.MICROSOFT_ADS_DEVELOPER_TOKEN || '').trim();
}

function assertConfig() {
  const missing = [];
  if (!getDeveloperToken()) missing.push('MICROSOFT_ADS_DEVELOPER_TOKEN');
  if (!getCustomerId()) missing.push('MICROSOFT_ADS_CUSTOMER_ID');
  if (!getAccountId()) missing.push('MICROSOFT_ADS_ACCOUNT_ID');
  if (!process.env.MICROSOFT_ADS_CLIENT_ID) missing.push('MICROSOFT_ADS_CLIENT_ID');
  if (!process.env.MICROSOFT_ADS_CLIENT_SECRET) missing.push('MICROSOFT_ADS_CLIENT_SECRET');
  if (!process.env.MICROSOFT_ADS_REFRESH_TOKEN) missing.push('MICROSOFT_ADS_REFRESH_TOKEN');
  if (missing.length) {
    throw new Error(`Microsoft Ads offline conversions not configured: ${missing.join(', ')}`);
  }
}

async function getAccessToken() {
  assertConfig();

  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_ADS_CLIENT_ID,
    client_secret: process.env.MICROSOFT_ADS_CLIENT_SECRET,
    refresh_token: process.env.MICROSOFT_ADS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
    scope: SCOPES,
  });

  try {
    const { data } = await axios.post(TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!data?.access_token) {
      throw new Error('No access_token in Microsoft token response');
    }
    return data.access_token;
  } catch (error) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    throw new Error(`Microsoft OAuth token refresh failed: ${detail}`);
  }
}

function formatConversionTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid conversion time');
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function resolveConversionTime(taskDoc, options = {}) {
  if (options.conversionDateTime) {
    return options.conversionDateTime instanceof Date
      ? options.conversionDateTime
      : new Date(options.conversionDateTime);
  }

  const payment = await PaymentHistory.findOne({
    taskId: taskDoc._id,
    status: 'success',
  })
    .sort({ paymentDate: -1 })
    .select('paymentDate')
    .lean();

  if (payment?.paymentDate) return payment.paymentDate;
  if (taskDoc.updatedAt) return taskDoc.updatedAt;
  return taskDoc.createdAt || new Date();
}

async function resolveMsclkid(taskDoc) {
  if (taskDoc.msclkid && String(taskDoc.msclkid).trim()) {
    return String(taskDoc.msclkid).trim();
  }
  if (!taskDoc.quotationId) return null;

  const quote = await QuotationRequest.findById(taskDoc.quotationId)
    .select('msclkid')
    .lean();
  const fromQuote = quote?.msclkid && String(quote.msclkid).trim();
  return fromQuote || null;
}

function resolveValue(taskDoc, amount) {
  if (amount != null && !Number.isNaN(Number(amount))) {
    return Number(amount);
  }
  if (taskDoc.totalPrice != null && !Number.isNaN(Number(taskDoc.totalPrice))) {
    return Number(taskDoc.totalPrice);
  }
  if (taskDoc.paidAmount?.amount != null && !Number.isNaN(Number(taskDoc.paidAmount.amount))) {
    return Number(taskDoc.paidAmount.amount);
  }
  return 1;
}

/** Only quote-linked Paid orders (goal: quote-to-purchase). */
function shouldUploadPurchase(task) {
  if (!task || task.microsoftAdsOfflineConversionExportedAt) {
    return false;
  }
  if (task.paymentStatus !== 'Paid') {
    return false;
  }
  if (!task.quotationId) {
    return false;
  }
  return true;
}

async function applyOfflineConversions(offlineConversions) {
  if (!offlineConversions?.length) {
    throw new Error('No offline conversions to apply');
  }

  const accessToken = await getAccessToken();

  const { data, status } = await axios.post(
    APPLY_URL,
    { OfflineConversions: offlineConversions },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        DeveloperToken: getDeveloperToken(),
        CustomerId: getCustomerId(),
        CustomerAccountId: getAccountId(),
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    },
  );

  if (status >= 400) {
    const message = JSON.stringify(data);
    if (/IdentityTypeMismatch|GoogleAccountIsRequired/i.test(message)) {
      throw new Error(
        `ApplyOfflineConversions failed (HTTP ${status}): Ads user must sign in with a Microsoft account (not Google). `
        + `Invite a Microsoft-signed-in Super Admin, re-run scripts/authorizeMicrosoftAds.js, update MICROSOFT_ADS_REFRESH_TOKEN. Detail: ${message}`,
      );
    }
    throw new Error(`ApplyOfflineConversions failed (HTTP ${status}): ${message}`);
  }

  const partial = data?.PartialErrors || data?.partialErrors;
  if (Array.isArray(partial) && partial.length > 0) {
    throw new Error(`ApplyOfflineConversions partial errors: ${JSON.stringify(partial)}`);
  }

  return data;
}

async function buildOfflineConversionRow(taskDoc, options = {}) {
  const msclkid = await resolveMsclkid(taskDoc);
  if (!msclkid) {
    return { skipped: true, reason: 'no_msclkid' };
  }

  const conversionName = getConversionName();
  const conversionTime = formatConversionTime(
    await resolveConversionTime(taskDoc, options),
  );
  const conversionValue = resolveValue(taskDoc, options.amount);

  return {
    row: {
      MicrosoftClickId: msclkid,
      ConversionName: conversionName,
      ConversionTime: conversionTime,
      ConversionValue: conversionValue,
      ConversionCurrencyCode: CURRENCY,
    },
    orderId: taskDoc.orderNumber || String(taskDoc._id),
    msclkid,
    conversionName,
  };
}

async function uploadPurchaseConversion(task, options = {}) {
  if (!isEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const taskDoc = task?._id && typeof task.save === 'function'
    ? task
    : await Task.findById(task?._id || task);

  if (!taskDoc || !shouldUploadPurchase(taskDoc)) {
    return { skipped: true, reason: 'not_eligible' };
  }

  const built = await buildOfflineConversionRow(taskDoc, options);
  if (built.skipped) {
    return built;
  }

  console.log('[Microsoft Ads] Offline upload attempt', {
    orderId: built.orderId,
    conversionName: built.conversionName,
    msclkid: `${built.msclkid.slice(0, 12)}...`,
    conversionValue: built.row.ConversionValue,
  });

  try {
    const result = await applyOfflineConversions([built.row]);
    taskDoc.microsoftAdsOfflineConversionExportedAt = new Date();
    taskDoc.microsoftAdsConversionError = null;
    await taskDoc.save();
    console.log(
      `[Microsoft Ads] Accepted offline conversion for order ${built.orderId} (${built.conversionName})`,
    );
    return { success: true, orderId: built.orderId, conversionName: built.conversionName, result };
  } catch (error) {
    taskDoc.microsoftAdsConversionError = error.message;
    await taskDoc.save();
    throw error;
  }
}

/** Test path: ignores ENABLED flag; optional markExported. */
async function uploadPurchaseConversionForTest(task, options = {}) {
  assertConfig();

  const taskDoc = task?._id && typeof task.save === 'function'
    ? task
    : await Task.findById(task?._id || task);

  if (!taskDoc) {
    return { skipped: true, reason: 'not_found' };
  }

  if (!taskDoc.quotationId) {
    return { skipped: true, reason: 'not_quote_linked' };
  }

  if (taskDoc.paymentStatus !== 'Paid' && !options.allowUnpaid) {
    return { skipped: true, reason: 'not_paid' };
  }

  const built = await buildOfflineConversionRow(taskDoc, options);
  if (built.skipped) {
    return built;
  }

  const result = await applyOfflineConversions([built.row]);

  if (options.markExported) {
    taskDoc.microsoftAdsOfflineConversionExportedAt = new Date();
    taskDoc.microsoftAdsConversionError = null;
    await taskDoc.save();
  }

  return {
    success: true,
    orderId: built.orderId,
    conversionName: built.conversionName,
    row: built.row,
    result,
  };
}

function fireMicrosoftAdsPurchaseUpload(task, options = {}) {
  uploadPurchaseConversion(task, options).catch((error) => {
    console.error('[Microsoft Ads] Offline conversion upload failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  });
}

module.exports = {
  isEnabled,
  getConversionName,
  uploadPurchaseConversion,
  uploadPurchaseConversionForTest,
  fireMicrosoftAdsPurchaseUpload,
  applyOfflineConversions,
  getAccessToken,
  shouldUploadPurchase,
  resolveMsclkid,
};
