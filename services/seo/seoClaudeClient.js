const Anthropic = require('@anthropic-ai/sdk');
const {
  getAnthropicApiKey,
  getSeoAgentModel,
  getSeoAgentTimeoutMs,
} = require('../../config/seoConfig');

const SEO_SYSTEM_PROMPT = [
  'You are an SEO specialist for London Waste Management (skip hire and waste services in London, UK).',
  'Use British English.',
  'Never invent rankings, traffic, or GSC metrics that were not provided in the user message.',
  'Return only valid JSON matching the schema requested. No markdown fences.',
].join(' ');

function getClient() {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY is not configured');
    err.code = 'SEO_AGENT_NOT_CONFIGURED';
    throw err;
  }
  return new Anthropic({ apiKey, timeout: getSeoAgentTimeoutMs() });
}

function extractTextContent(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const text = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Claude returned an empty response');
  }
  return text;
}

function parseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('Claude returned invalid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Claude JSON must be an object');
  }
  return parsed;
}

/**
 * @param {object} options
 * @param {string} options.userPrompt
 * @param {number} [options.maxTokens]
 * @param {string} [options.model]
 * @returns {Promise<{ data: object, usage: object, model: string }>}
 */
async function createJsonCompletion({ userPrompt, maxTokens = 4096, model } = {}) {
  if (!userPrompt || !String(userPrompt).trim()) {
    throw new Error('userPrompt is required');
  }

  const client = getClient();
  const resolvedModel = model || getSeoAgentModel();

  const message = await client.messages.create({
    model: resolvedModel,
    max_tokens: maxTokens,
    system: SEO_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: String(userPrompt) }],
  });

  const text = extractTextContent(message);
  const data = parseJsonObject(text);

  return {
    data,
    usage: {
      inputTokens: message.usage?.input_tokens ?? null,
      outputTokens: message.usage?.output_tokens ?? null,
    },
    model: resolvedModel,
  };
}

module.exports = {
  createJsonCompletion,
  SEO_SYSTEM_PROMPT,
};
