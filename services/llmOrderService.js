const axios = require('axios');
const {
  getLatestMessageIdInThread,
  collectOrderAttachmentsFromMessages,
} = require('./gmailService');
const { buildSuggestReplyPythonPayloadForThread } = require('./suggestReplyService');

const LLM_ORDER_URL =
  process.env.LLM_ORDER_URL || 'http://localhost:8001/order_llm';

const LLM_ORDER_TIMEOUT_MS =
  Number(process.env.LLM_ORDER_TIMEOUT_MS) || 60000;

function normalizeLlmOrderResponse(data, pythonPayload, ctx, attachments) {
  const customer =
    data?.customer && typeof data.customer === 'object' ? data.customer : {};

  const items = Array.isArray(data?.items)
    ? data.items.map((item) => {
        const normalized = {
          phrase: item?.phrase ?? '',
          quantity:
            typeof item?.quantity === 'number'
              ? item.quantity
              : Number(item?.quantity) || 0,
          status: item?.status ?? null,
        };

        if (item?.item_id != null && String(item.item_id).trim()) {
          normalized.item_id = String(item.item_id).trim();
        }
        if (item?.item_name != null && String(item.item_name).trim()) {
          normalized.item_name = String(item.item_name).trim();
        }

        return normalized;
      })
    : [];

  const order = {
    customer: {
      firstName: customer.firstName ?? null,
      lastName: customer.lastName ?? null,
      phoneNumber: customer.phoneNumber ?? null,
      email: customer.email ?? null,
      postcode: customer.postcode ?? null,
      address: customer.address ?? null,
    },
    items,
    bookingDate: data?.bookingDate ?? null,
    bookingTimeSlot: data?.bookingTimeSlot ?? null,
    customerNote: data?.customerNote ?? null,
    attachments,
    source: data?.source ?? null,
    llm_error: data?.llm_error ?? null,
    subject: data?.subject || pythonPayload.message?.subject || '',
    threadId: data?.threadId || pythonPayload.message?.threadId || ctx.threadId,
    messageId:
      data?.messageId || pythonPayload.message?.messageId || ctx.messageId,
  };

  const warning =
    data?.warning != null && String(data.warning).trim()
      ? String(data.warning).trim()
      : null;
  if (warning) {
    order.warning = warning;
  }

  return order;
}

async function callPythonLlmOrder(pythonPayload, ctx, attachments) {
  console.log('[LLM Order] Payload:', JSON.stringify(pythonPayload, null, 2));

  const res = await axios.post(LLM_ORDER_URL, pythonPayload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: LLM_ORDER_TIMEOUT_MS,
  });

  return normalizeLlmOrderResponse(res.data, pythonPayload, ctx, attachments);
}

async function llmOrderForTargetMessage(adminId, threadId, messageId) {
  const { payload, ctx } = await buildSuggestReplyPythonPayloadForThread(
    adminId,
    threadId,
    messageId
  );

  const attachments = collectOrderAttachmentsFromMessages(
    ctx.messagesThroughTarget || []
  );

  console.log(
    `[LLM Order] threadId=${ctx.threadId} targetMessageId=${ctx.messageId} threadCount=${ctx.threadHistory.length} attachments=${attachments.length}`
  );

  return callPythonLlmOrder(payload, ctx, attachments);
}

/** Uses messageId when provided; otherwise newest message in thread. */
async function llmOrderForThread(adminId, threadId, messageId) {
  const targetMessageId =
    messageId || (await getLatestMessageIdInThread(adminId, threadId));
  return llmOrderForTargetMessage(adminId, threadId, targetMessageId);
}

module.exports = {
  llmOrderForThread,
  llmOrderForTargetMessage,
};
