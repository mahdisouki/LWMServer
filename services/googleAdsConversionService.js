const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');
const {
  buildUserIdentifiers,
  formatConversionDateTime,
} = require('../utils/googleAdsEnhancedConversions');

const CURRENCY = 'GBP';
const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';

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

async function uploadClickConversions(conversions) {
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
      const row = {
        conversionAction: conversion.conversionAction,
        conversionDateTime: conversion.conversionDateTime,
        currencyCode: conversion.currencyCode || CURRENCY,
        userIdentifiers: mapUserIdentifiersForApi(conversion.userIdentifiers || []),
      };

      if (conversion.conversionValue != null && !Number.isNaN(Number(conversion.conversionValue))) {
        row.conversionValue = Number(conversion.conversionValue);
      }
      if (conversion.orderId) {
        row.orderId = String(conversion.orderId);
      }
      if (conversion.gclid) {
        row.gclid = conversion.gclid;
      }
      if (conversion.gbraid) {
        row.gbraid = conversion.gbraid;
      }
      if (conversion.wbraid) {
        row.wbraid = conversion.wbraid;
      }

      return row;
    }),
    partialFailure: true,
  };

  try {
    const { data } = await axios.post(url, payload, { headers });
    return data;
  } catch (error) {
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

function getOfflinePurchaseConversionAction() {
  return buildConversionActionResource(
    process.env.GOOGLE_ADS_CONVERSION_ACTION_OFFLINE_PURCHASE_ID
      || process.env.GOOGLE_ADS_CONVERSION_ACTION_OFFLINE_PURCHASE_RESOURCE,
  );
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
  // Quote-to-purchase: task may be created by staff; payment is still a valid conversion.
  if (task.quotationId) {
    return true;
  }
  if (task.createdByType && task.createdByType !== 'public') {
    return false;
  }
  return true;
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
  const conversionDateTime = formatConversionDateTime(options.conversionDateTime || new Date());

  const result = await uploadClickConversions([{
    conversionAction,
    conversionDateTime,
    conversionValue,
    currencyCode: CURRENCY,
    orderId,
    userIdentifiers,
    gclid: clickIds.gclid,
    gbraid: clickIds.gbraid,
    wbraid: clickIds.wbraid,
  }]);

  taskDoc.googleAdsPurchaseConversionSentAt = new Date();
  await taskDoc.save();

  const purchaseType = isQuotePurchase ? 'offline quote' : 'online';
  console.log(`[Google Ads] ${purchaseType} purchase conversion uploaded for order ${orderId}`);
  return { success: true, orderId, result };
}

async function uploadQuoteConversion(quotation) {
  if (!isEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const quoteDoc = quotation?._id && typeof quotation.save === 'function'
    ? quotation
    : await QuotationRequest.findById(quotation?._id || quotation);

  if (!quoteDoc || quoteDoc.googleAdsQuoteConversionSentAt) {
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

  const result = await uploadClickConversions([{
    conversionAction,
    conversionDateTime,
    conversionValue: 0,
    currencyCode: CURRENCY,
    orderId,
    userIdentifiers,
    gclid: quoteDoc.gclid || undefined,
    gbraid: quoteDoc.gbraid || undefined,
    wbraid: quoteDoc.wbraid || undefined,
  }]);

  quoteDoc.googleAdsQuoteConversionSentAt = new Date();
  await quoteDoc.save();

  console.log(`[Google Ads] Quote conversion uploaded for ${orderId}`);
  return { success: true, orderId, result };
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
  uploadPurchaseConversion,
  uploadQuoteConversion,
  firePurchaseConversionUpload,
  fireQuoteConversionUpload,
};
