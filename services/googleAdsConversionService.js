const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');
const PaymentHistory = require('../models/PaymentHistory');
const {
  buildUserIdentifiers,
  formatConversionDateTime,
  formatEventTimestamp,
  parseConversionDateTime,
  buildDataManagerUserData,
} = require('../utils/googleAdsEnhancedConversions');

const CURRENCY = 'GBP';
const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';
const DATA_MANAGER_API_VERSION = process.env.GOOGLE_DATA_MANAGER_API_VERSION || 'v1';
const DATA_MANAGER_INGEST_URL = `https://datamanager.googleapis.com/${DATA_MANAGER_API_VERSION}/events:ingest`;

// Labels from frontend (AW-696532233/RHcJCKfAxtEDEIn6kMwC etc.) — map to numeric action IDs in env.
const PURCHASE_LABEL = 'RHcJCKfAxtEDEIn6kMwC';
const QUOTE_LABEL = 'wBkYCJC2l5QcEIn6kMwC';

function isEnabled() {
  return process.env.GOOGLE_ADS_CONVERSIONS_ENABLED === 'true';
}

function getCustomerId() {
  return String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
}

function buildConversionActionResource(actionIdOrResource) {
  if (!actionIdOrResource) {
    return null;
  }
  if (String(actionIdOrResource).startsWith('customers/')) {
    return actionIdOrResource;
  }
  const customerId = getCustomerId();
  if (!customerId) {
    return null;
  }
  return `customers/${customerId}/conversionActions/${actionIdOrResource}`;
}

function getPurchaseConversionAction() {
  return buildConversionActionResource(
    process.env.GOOGLE_ADS_CONVERSION_ACTION_PURCHASE_ID
      || process.env.GOOGLE_ADS_CONVERSION_ACTION_PURCHASE_RESOURCE,
  );
}

function getQuoteConversionAction() {
  return buildConversionActionResource(
    process.env.GOOGLE_ADS_CONVERSION_ACTION_QUOTE_ID
      || process.env.GOOGLE_ADS_CONVERSION_ACTION_QUOTE_RESOURCE,
  );
}

function getOfflinePurchaseConversionAction() {
  return buildConversionActionResource(
    process.env.GOOGLE_ADS_CONVERSION_ACTION_OFFLINE_PURCHASE_ID
      || process.env.GOOGLE_ADS_CONVERSION_ACTION_OFFLINE_PURCHASE_RESOURCE,
  );
}

function getConversionTransport() {
  const transport = String(process.env.GOOGLE_ADS_CONVERSION_TRANSPORT || 'data_manager').toLowerCase();
  return transport === 'legacy' ? 'legacy' : 'data_manager';
}

function extractConversionActionId(conversionAction) {
  if (!conversionAction) {
    return null;
  }
  const resourceMatch = String(conversionAction).match(/conversionActions\/(\d+)$/);
  if (resourceMatch) {
    return resourceMatch[1];
  }
  if (/^\d+$/.test(String(conversionAction))) {
    return String(conversionAction);
  }
  return null;
}

function buildDataManagerDestination(conversionActionId) {
  const customerId = getCustomerId();
  if (!customerId || !conversionActionId) {
    return null;
  }

  const destination = {
    operatingAccount: {
      accountType: 'GOOGLE_ADS',
      accountId: customerId,
    },
    productDestinationId: String(conversionActionId),
  };

  const loginCustomerId = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
  if (loginCustomerId) {
    destination.loginAccount = {
      accountType: 'GOOGLE_ADS',
      accountId: loginCustomerId,
    };
  }

  return destination;
}

/**
 * Data Manager / offline uploads: prefer gclid alone; gbraid/wbraid cannot be
 * combined with enhanced-conversion userData (hashed email/phone).
 */
function resolveDataManagerAttribution({ gclid, gbraid, wbraid, userIdentifiers = [] }) {
  if (gclid) {
    return {
      gclid,
      gbraid: undefined,
      wbraid: undefined,
      userIdentifiers,
    };
  }
  if (gbraid) {
    return {
      gclid: undefined,
      gbraid,
      wbraid: undefined,
      userIdentifiers: [],
    };
  }
  if (wbraid) {
    return {
      gclid: undefined,
      gbraid: undefined,
      wbraid,
      userIdentifiers: [],
    };
  }
  return {
    gclid: undefined,
    gbraid: undefined,
    wbraid: undefined,
    userIdentifiers,
  };
}

function buildDataManagerEvent(conversion) {
  const event = {
    eventTimestamp: formatEventTimestamp(parseConversionDateTime(conversion.conversionDateTime)),
    eventSource: 'WEB',
  };

  if (conversion.orderId) {
    event.transactionId = String(conversion.orderId);
  }

  const attribution = resolveDataManagerAttribution({
    gclid: conversion.gclid,
    gbraid: conversion.gbraid,
    wbraid: conversion.wbraid,
    userIdentifiers: conversion.userIdentifiers || [],
  });

  const adIdentifiers = {};
  if (attribution.gclid) {
    adIdentifiers.gclid = attribution.gclid;
  }
  if (attribution.gbraid) {
    adIdentifiers.gbraid = attribution.gbraid;
  }
  if (attribution.wbraid) {
    adIdentifiers.wbraid = attribution.wbraid;
  }
  if (Object.keys(adIdentifiers).length > 0) {
    event.adIdentifiers = adIdentifiers;
  }

  const userData = buildDataManagerUserData(attribution.userIdentifiers);
  if (userData) {
    event.userData = userData;
  }

  if (conversion.conversionValue != null && !Number.isNaN(Number(conversion.conversionValue))) {
    event.conversionValue = Number(conversion.conversionValue);
  }
  if (conversion.currencyCode) {
    event.currency = conversion.currencyCode;
  }

  return event;
}

function parseDataManagerError(error) {
  const detail = error.response?.data?.error;
  if (!detail) {
    return null;
  }
  const parts = [detail.message, detail.status].filter(Boolean);
  for (const err of detail.errors || []) {
    if (err.message) {
      parts.push(err.message);
    }
  }
  for (const violation of detail.details || []) {
    if (violation['@type']?.includes('BadRequest')) {
      for (const fieldViolation of violation.fieldViolations || []) {
        parts.push(
          `${fieldViolation.field || 'field'}: ${fieldViolation.description || fieldViolation.reason || ''}`.trim(),
        );
      }
    }
  }
  return parts.join('; ') || JSON.stringify(detail);
}

async function ingestDataManagerEvents(conversions, options = {}) {
  if (!conversions?.length) {
    throw new Error('No conversions to ingest');
  }

  const conversionActionId = extractConversionActionId(conversions[0].conversionAction);
  const destination = buildDataManagerDestination(conversionActionId);
  if (!destination) {
    throw new Error('Data Manager destination is not configured (customer ID or conversion action ID missing)');
  }

  const events = conversions.map(buildDataManagerEvent);
  const hasIdentifiers = events.every((event) => (
    event.adIdentifiers
    || event.userData?.userIdentifiers?.length
  ));
  if (!hasIdentifiers) {
    throw new Error('Data Manager event requires adIdentifiers (gclid/gbraid/wbraid) or userData');
  }

  const accessToken = await getAccessToken();
  const payload = {
    destinations: [destination],
    encoding: 'HEX',
    events,
    validateOnly: Boolean(options.validateOnly),
  };

  try {
    const { data } = await axios.post(DATA_MANAGER_INGEST_URL, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (options.validateOnly) {
      console.log('[Google Ads] Data Manager validateOnly passed — payload accepted by Google');
    }

    return data;
  } catch (error) {
    const dmError = parseDataManagerError(error);
    const status = error.response?.status;
    const detailText = dmError || (error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message);

    if (status === 403 && /insufficient|scope|permission/i.test(detailText)) {
      throw new Error(
        `Data Manager API auth failed (HTTP ${status}): ${detailText}. `
        + 'Re-authorize OAuth with scope https://www.googleapis.com/auth/datamanager',
      );
    }

    throw new Error(
      `Data Manager events:ingest failed (${DATA_MANAGER_API_VERSION}, HTTP ${status || 'n/a'}): ${detailText}`,
    );
  }
}

async function getAccessToken() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Ads OAuth credentials are not configured');
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const response = await oauth2Client.getAccessToken();
  if (!response?.token) {
    throw new Error('Failed to obtain Google Ads access token');
  }
  return response.token;
}

function mapUserIdentifiersForApi(identifiers) {
  return identifiers.map((entry) => {
    if (entry.hashedEmail) {
      return {
        userIdentifierSource: 'FIRST_PARTY',
        hashedEmail: entry.hashedEmail,
      };
    }
    if (entry.hashedPhoneNumber) {
      return {
        userIdentifierSource: 'FIRST_PARTY',
        hashedPhoneNumber: entry.hashedPhoneNumber,
      };
    }
    return null;
  }).filter(Boolean);
}

function parsePartialFailureError(response) {
  const failure = response?.partialFailureError;
  if (!failure) {
    return null;
  }

  const messages = [];
  for (const detail of failure.details || []) {
    for (const err of detail.errors || []) {
      const code = err.errorCode
        ? Object.values(err.errorCode).find(Boolean) || JSON.stringify(err.errorCode)
        : 'UNKNOWN';
      messages.push(`${code}: ${err.message || ''}`.trim());
    }
  }

  if (messages.length > 0) {
    return messages.join('; ');
  }

  return failure.message || JSON.stringify(failure);
}

function logConversionAttempt(label, {
  orderId,
  conversionAction,
  gclid,
  gbraid,
  wbraid,
  validateOnly,
  transport,
}) {
  console.log('[Google Ads] Upload attempt', {
    type: label,
    orderId,
    conversionAction,
    transport: transport || getConversionTransport(),
    validateOnly: Boolean(validateOnly),
    clickIds: {
      gclid: Boolean(gclid),
      gbraid: Boolean(gbraid),
      wbraid: Boolean(wbraid),
    },
  });
}

async function uploadConversions(conversions, options = {}) {
  const transport = options.transport || getConversionTransport();
  if (transport === 'legacy') {
    return uploadClickConversions(conversions, options);
  }
  return ingestDataManagerEvents(conversions, options);
}

async function uploadClickConversions(conversions, options = {}) {
  const customerId = getCustomerId();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!customerId || !developerToken) {
    throw new Error('GOOGLE_ADS_CUSTOMER_ID and GOOGLE_ADS_DEVELOPER_TOKEN are required');
  }

  const accessToken = await getAccessToken();
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:uploadClickConversions`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };

  const loginCustomerId = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  const payload = {
    conversions: conversions.map((conversion) => {
      const attribution = resolveDataManagerAttribution({
        gclid: conversion.gclid,
        gbraid: conversion.gbraid,
        wbraid: conversion.wbraid,
        userIdentifiers: conversion.userIdentifiers || [],
      });

      const row = {
        conversionAction: conversion.conversionAction,
        conversionDateTime: conversion.conversionDateTime,
        currencyCode: conversion.currencyCode || CURRENCY,
        userIdentifiers: mapUserIdentifiersForApi(attribution.userIdentifiers),
      };

      if (conversion.conversionValue != null && !Number.isNaN(Number(conversion.conversionValue))) {
        row.conversionValue = Number(conversion.conversionValue);
      }
      if (conversion.orderId) {
        row.orderId = String(conversion.orderId);
      }
      if (attribution.gclid) {
        row.gclid = attribution.gclid;
      }
      if (attribution.gbraid) {
        row.gbraid = attribution.gbraid;
      }
      if (attribution.wbraid) {
        row.wbraid = attribution.wbraid;
      }

      return row;
    }),
    partialFailure: true,
    validateOnly: Boolean(options.validateOnly),
  };

  try {
    const { data } = await axios.post(url, payload, { headers });
    const partialFailure = parsePartialFailureError(data);
    if (partialFailure) {
      const suffix = options.validateOnly ? ' (validateOnly)' : '';
      throw new Error(`Google Ads conversion rejected${suffix}: ${partialFailure}`);
    }
    if (options.validateOnly) {
      console.log('[Google Ads] validateOnly passed — payload accepted by Google');
    }
    return data;
  } catch (error) {
    if (error.message?.startsWith('Google Ads conversion rejected')) {
      throw error;
    }
    const status = error.response?.status;
    const detail = error.response?.data;
    const detailText = detail ? JSON.stringify(detail) : error.message;
    throw new Error(
      `Google Ads uploadClickConversions failed (${GOOGLE_ADS_API_VERSION}, HTTP ${status || 'n/a'}): ${detailText}`,
    );
  }
}

function resolvePurchaseValue(task, amount) {
  if (task?.paymentStatus === 'Paid' && task?.totalPrice != null && !Number.isNaN(Number(task.totalPrice))) {
    return Number(task.totalPrice);
  }
  if (amount != null && !Number.isNaN(Number(amount))) {
    return Number(amount);
  }
  if (task?.paidAmount?.amount != null && !Number.isNaN(Number(task.paidAmount.amount))) {
    return Number(task.paidAmount.amount);
  }
  if (task?.totalPrice != null && !Number.isNaN(Number(task.totalPrice))) {
    return Number(task.totalPrice);
  }
  return 1;
}

async function resolvePurchaseConversionDateTime(taskDoc, options = {}) {
  if (options.conversionDateTime) {
    return options.conversionDateTime;
  }

  const payment = await PaymentHistory.findOne({
    taskId: taskDoc._id,
    status: 'success',
  })
    .sort({ paymentDate: -1 })
    .select('paymentDate')
    .lean();

  if (payment?.paymentDate) {
    return payment.paymentDate;
  }

  if (taskDoc.updatedAt) {
    return taskDoc.updatedAt;
  }

  return taskDoc.createdAt || new Date();
}

async function resolveClickIdsForTask(taskDoc) {
  const ids = {
    gclid: taskDoc.gclid || undefined,
    gbraid: taskDoc.gbraid || undefined,
    wbraid: taskDoc.wbraid || undefined,
  };

  if ((ids.gclid || ids.gbraid || ids.wbraid) || !taskDoc.quotationId) {
    return ids;
  }

  const quote = await QuotationRequest.findById(taskDoc.quotationId)
    .select('gclid gbraid wbraid');
  if (!quote) {
    return ids;
  }

  return {
    gclid: ids.gclid || quote.gclid || undefined,
    gbraid: ids.gbraid || quote.gbraid || undefined,
    wbraid: ids.wbraid || quote.wbraid || undefined,
  };
}

function shouldUploadPurchase(task) {
  if (!task || task.googleAdsPurchaseConversionSentAt) {
    return false;
  }
  if (task.paymentStatus !== 'Paid') {
    return false;
  }
  // Website checkout is recorded by the Google tag on the same conversion action.
  // Server uploads are only for quote-to-purchase (offline conversion action).
  return Boolean(task.quotationId);
}

function shouldValidatePurchase(task) {
  if (!task) {
    return false;
  }
  if (task.paymentStatus !== 'Paid') {
    return false;
  }
  return Boolean(task.quotationId);
}

async function buildPurchaseConversionRow(taskDoc, options = {}) {
  const isQuotePurchase = Boolean(taskDoc.quotationId);
  const conversionAction = isQuotePurchase
    ? getOfflinePurchaseConversionAction()
    : getPurchaseConversionAction();

  if (!conversionAction) {
    const actionLabel = isQuotePurchase
      ? 'GOOGLE_ADS_CONVERSION_ACTION_OFFLINE_PURCHASE_ID'
      : `Purchase conversion action (label ref: ${PURCHASE_LABEL})`;
    throw new Error(`${actionLabel} is not configured`);
  }

  const userIdentifiers = buildUserIdentifiers({
    email: taskDoc.email,
    phoneNumber: taskDoc.phoneNumber,
    phoneNumber2: taskDoc.phoneNumber2,
  });

  if (userIdentifiers.length === 0) {
    return { skipped: true, reason: 'no_user_identifiers' };
  }

  const clickIds = await resolveClickIdsForTask(taskDoc);
  const orderId = taskDoc.orderNumber || String(taskDoc._id);
  const conversionValue = resolvePurchaseValue(taskDoc, options.amount);
  const conversionDateTime = formatConversionDateTime(
    await resolvePurchaseConversionDateTime(taskDoc, options),
  );

  return {
    isQuotePurchase,
    conversionAction,
    orderId,
    row: {
      conversionAction,
      conversionDateTime,
      conversionValue,
      currencyCode: CURRENCY,
      orderId,
      userIdentifiers,
      gclid: clickIds.gclid,
      gbraid: clickIds.gbraid,
      wbraid: clickIds.wbraid,
    },
  };
}

async function uploadPurchaseConversion(task, options = {}) {
  if (!isEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const taskDoc = task?._id && typeof task.save === 'function'
    ? task
    : await Task.findById(task?._id || task);

  const validateOnly = Boolean(options.validateOnly);
  const eligible = validateOnly
    ? shouldValidatePurchase(taskDoc)
    : shouldUploadPurchase(taskDoc);

  if (!taskDoc || !eligible) {
    return { skipped: true, reason: 'not_eligible' };
  }

  const built = await buildPurchaseConversionRow(taskDoc, options);
  if (built.skipped) {
    return built;
  }

  const { isQuotePurchase, conversionAction, orderId, row } = built;
  const purchaseType = isQuotePurchase ? 'offline quote purchase' : 'online purchase';

  logConversionAttempt(purchaseType, {
    orderId,
    conversionAction,
    gclid: row.gclid,
    gbraid: row.gbraid,
    wbraid: row.wbraid,
    validateOnly,
  });

  try {
    const result = await uploadConversions([row], { validateOnly });

    if (!validateOnly) {
      taskDoc.googleAdsPurchaseConversionSentAt = new Date();
      taskDoc.googleAdsConversionError = null;
      await taskDoc.save();
      console.log(`[Google Ads] Google accepted ${purchaseType} conversion for order ${orderId}`);
    }

    return { success: true, orderId, validateOnly, result };
  } catch (error) {
    if (!validateOnly) {
      taskDoc.googleAdsConversionError = error.message;
      await taskDoc.save();
    }
    throw error;
  }
}

async function uploadQuoteConversion(quotation, options = {}) {
  if (!isEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const quoteDoc = quotation?._id && typeof quotation.save === 'function'
    ? quotation
    : await QuotationRequest.findById(quotation?._id || quotation);

  const validateOnly = Boolean(options.validateOnly);

  if (!quoteDoc) {
    return { skipped: true, reason: 'not_eligible' };
  }

  if (!validateOnly && quoteDoc.googleAdsQuoteConversionSentAt) {
    return { skipped: true, reason: 'not_eligible' };
  }

  const conversionAction = getQuoteConversionAction();
  if (!conversionAction) {
    throw new Error(`Quote conversion action not configured (label ref: ${QUOTE_LABEL})`);
  }

  const userIdentifiers = buildUserIdentifiers({
    email: quoteDoc.email,
    phoneNumber: quoteDoc.phoneNumber,
  });

  if (userIdentifiers.length === 0) {
    return { skipped: true, reason: 'no_user_identifiers' };
  }

  const orderId = `Q-${quoteDoc._id}`;
  const conversionDateTime = formatConversionDateTime(quoteDoc.createdAt || new Date());
  const gclid = quoteDoc.gclid || undefined;
  const gbraid = quoteDoc.gbraid || undefined;
  const wbraid = quoteDoc.wbraid || undefined;

  logConversionAttempt('quote', {
    orderId,
    conversionAction,
    gclid,
    gbraid,
    wbraid,
    validateOnly,
  });

  try {
    const result = await uploadConversions([{
      conversionAction,
      conversionDateTime,
      conversionValue: 0,
      currencyCode: CURRENCY,
      orderId,
      userIdentifiers,
      gclid,
      gbraid,
      wbraid,
    }], { validateOnly });

    if (!validateOnly) {
      quoteDoc.googleAdsQuoteConversionSentAt = new Date();
      quoteDoc.googleAdsConversionError = null;
      await quoteDoc.save();
      console.log(`[Google Ads] Google accepted quote conversion for ${orderId}`);
    }

    return { success: true, orderId, validateOnly, result };
  } catch (error) {
    if (!validateOnly) {
      quoteDoc.googleAdsConversionError = error.message;
      await quoteDoc.save();
    }
    throw error;
  }
}

function validatePurchaseConversion(task, options = {}) {
  return uploadPurchaseConversion(task, { ...options, validateOnly: true });
}

function validateQuoteConversion(quotation, options = {}) {
  return uploadQuoteConversion(quotation, { ...options, validateOnly: true });
}

function firePurchaseConversionUpload(task, options = {}) {
  uploadPurchaseConversion(task, options).catch((error) => {
    console.error('[Google Ads] Purchase conversion upload failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  });
}

function fireQuoteConversionUpload(quotation) {
  uploadQuoteConversion(quotation).catch((error) => {
    console.error('[Google Ads] Quote conversion upload failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  });
}

module.exports = {
  CURRENCY,
  PURCHASE_LABEL,
  QUOTE_LABEL,
  isEnabled,
  getConversionTransport,
  uploadPurchaseConversion,
  uploadQuoteConversion,
  validatePurchaseConversion,
  validateQuoteConversion,
  firePurchaseConversionUpload,
  fireQuoteConversionUpload,
};
