const SeoAuditIssue = require('../../models/SeoAuditIssue');
const SeoSiteSnapshot = require('../../models/SeoSiteSnapshot');
const {
  isSeoAgentEnabled,
  getAnthropicApiKey,
  getSeoAgentMaxIssues,
  getSiteHostname,
} = require('../../config/seoConfig');
const { createJsonCompletion } = require('./seoClaudeClient');
const { buildAiActionPlan } = require('./seoAuditService');

function assertAgentReady() {
  if (!isSeoAgentEnabled()) {
    const err = new Error('SEO agent is disabled. Set SEO_AGENT_ENABLED=true to use Claude.');
    err.code = 'SEO_AGENT_DISABLED';
    err.statusCode = 503;
    throw err;
  }
  if (!getAnthropicApiKey()) {
    const err = new Error('ANTHROPIC_API_KEY is not configured');
    err.code = 'SEO_AGENT_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }
}

function getAgentStatus() {
  return {
    enabled: isSeoAgentEnabled(),
    configured: Boolean(getAnthropicApiKey()),
    ready: isSeoAgentEnabled() && Boolean(getAnthropicApiKey()),
  };
}

function validateFixStepsArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const steps = value
    .filter((step) => typeof step === 'string')
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 8);
  return steps.length ? steps : null;
}

/**
 * Enrich rule-based audit issues with Claude-written fix steps.
 * @param {string} siteUrl
 * @param {Array<object>} [issues] - optional in-memory issues; otherwise load from DB
 */
async function enrichAuditIssues(siteUrl, issues = null) {
  assertAgentReady();

  const sourceIssues = Array.isArray(issues) && issues.length
    ? issues
    : await SeoAuditIssue.find({ siteUrl }).lean();

  if (!sourceIssues.length) {
    return { enriched: 0, issues: [], usage: null, model: null };
  }

  const maxIssues = getSeoAgentMaxIssues();
  const limited = sourceIssues.slice(0, maxIssues).map((issue) => ({
    issueKey: issue.issueKey,
    title: issue.title,
    severity: issue.severity,
    description: issue.description,
    affectedPageCount: issue.affectedPageCount,
    affectedUrls: (issue.affectedUrls || []).slice(0, 8),
    currentFixSteps: issue.aiFixSteps || [],
  }));

  const userPrompt = [
    `Enrich SEO audit fix steps for ${getSiteHostname()}.`,
    'Return JSON with this shape:',
    '{"issues":[{"issueKey":"string","aiFixSteps":["step1","step2"],"expectedImprovement":"string"}]}',
    'Rules:',
    '- Include every issueKey provided.',
    '- aiFixSteps must be concrete, URL-aware when URLs are given, and actionable for developers/editors.',
    '- Keep 2–5 steps per issue.',
    '- expectedImprovement is optional short text.',
    '',
    'Issues JSON:',
    JSON.stringify(limited),
  ].join('\n');

  const { data, usage, model } = await createJsonCompletion({
    userPrompt,
    maxTokens: 4096,
  });

  if (!Array.isArray(data.issues)) {
    throw new Error('Claude audit response missing issues array');
  }

  const byKey = new Map();
  for (const row of data.issues) {
    if (!row || typeof row.issueKey !== 'string') {
      continue;
    }
    const steps = validateFixStepsArray(row.aiFixSteps);
    if (!steps) {
      throw new Error(`Claude returned invalid aiFixSteps for issueKey ${row.issueKey}`);
    }
    byKey.set(row.issueKey, {
      aiFixSteps: steps,
      expectedImprovement: typeof row.expectedImprovement === 'string'
        ? row.expectedImprovement.trim()
        : null,
    });
  }

  for (const issue of limited) {
    if (!byKey.has(issue.issueKey)) {
      throw new Error(`Claude omitted issueKey ${issue.issueKey}`);
    }
  }

  const enrichedIssues = [];
  for (const issue of sourceIssues) {
    const update = byKey.get(issue.issueKey);
    if (!update) {
      enrichedIssues.push(issue);
      continue;
    }

    const $set = { aiFixSteps: update.aiFixSteps };
    if (update.expectedImprovement) {
      $set.expectedImprovement = update.expectedImprovement;
    }

    await SeoAuditIssue.updateOne(
      { siteUrl, issueKey: issue.issueKey },
      { $set },
    );

    enrichedIssues.push({
      ...issue,
      ...$set,
    });
  }

  const aiActionPlan = buildAiActionPlan(enrichedIssues);
  await SeoSiteSnapshot.updateOne(
    { siteUrl },
    { $set: { 'siteHealth.aiActionPlan': aiActionPlan } },
  );

  return {
    enriched: byKey.size,
    issues: enrichedIssues,
    aiActionPlan,
    usage,
    model,
  };
}

/**
 * Generate blog draft fields from a content gap via Claude.
 * @param {object} gap
 * @returns {Promise<{ title: string, description: string, tags: string[], metaTitle?: string, metaDescription?: string, usage: object, model: string }>}
 */
async function generateBlogFromContentGap(gap) {
  assertAgentReady();

  if (!gap || !gap.keyword) {
    throw new Error('Content gap keyword is required');
  }

  const userPrompt = [
    `Write an SEO blog draft for London Waste Management about: "${gap.keyword}".`,
    'Return JSON with this exact shape:',
    JSON.stringify({
      title: 'string',
      description: 'HTML string with h2/h3/p/ul/li only',
      tags: ['string'],
      metaTitle: 'string under 60 chars',
      metaDescription: 'string 120-160 chars',
    }),
    'Rules:',
    '- British English, practical UK skip-hire / waste tone.',
    '- description must be HTML suitable for a CMS body (no html/body/script tags).',
    '- Include an FAQ section with 3 questions as h3 + p.',
    '- Mention London / local relevance where natural.',
    '- Do not invent fake company awards, licenses, or reviews.',
    '',
    'Context:',
    JSON.stringify({
      keyword: gap.keyword,
      insight: gap.insight || '',
      volume: gap.volume ?? null,
      keywordDifficulty: gap.keywordDifficulty ?? null,
      competitorName: gap.competitorName || null,
      site: getSiteHostname(),
    }),
  ].join('\n');

  const { data, usage, model } = await createJsonCompletion({
    userPrompt,
    maxTokens: 5000,
  });

  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (!title || !description) {
    throw new Error('Claude blog response missing title or description');
  }

  const tags = Array.isArray(data.tags)
    ? data.tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8)
    : String(gap.keyword).split(/\s+/).filter(Boolean).slice(0, 5);

  if (!tags.length) {
    throw new Error('Claude blog response missing tags');
  }

  return {
    title,
    description,
    tags,
    metaTitle: typeof data.metaTitle === 'string' ? data.metaTitle.trim() : null,
    metaDescription: typeof data.metaDescription === 'string' ? data.metaDescription.trim() : null,
    usage,
    model,
  };
}

module.exports = {
  getAgentStatus,
  assertAgentReady,
  enrichAuditIssues,
  generateBlogFromContentGap,
};
