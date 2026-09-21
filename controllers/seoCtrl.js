const seoService = require('../services/seo/seoRefreshService');
const competitorService = require('../services/seo/seoCompetitorService');
const seoAgentService = require('../services/seo/seoAgentService');
const indexationService = require('../services/seo/seoIndexationService');
const { getTopSearchKeywords } = require('../services/topSearchKeywordsService');
const { getSiteUrl } = require('../config/seoConfig');

function siteUrlFromReq(req) {
  return req.query.siteUrl || getSiteUrl();
}

const seoCtrl = {
  getOverview: async (req, res) => {
    try {
      const data = await seoService.getOverview(siteUrlFromReq(req));
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load SEO overview', error: error.message });
    }
  },

  getSiteHealth: async (req, res) => {
    try {
      const data = await seoService.getSiteHealth(siteUrlFromReq(req));
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load site health', error: error.message });
    }
  },

  getAuditSummary: async (req, res) => {
    try {
      const data = await seoService.getAuditSummary(siteUrlFromReq(req));
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load audit summary', error: error.message });
    }
  },

  getAuditIssues: async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const data = await seoService.getAuditIssues(siteUrlFromReq(req), {
        severity: req.query.severity || 'all',
        page,
        limit,
      });
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load audit issues', error: error.message });
    }
  },

  getAuditIssueById: async (req, res) => {
    try {
      const issue = await seoService.getAuditIssueById(siteUrlFromReq(req), req.params.id);
      if (!issue) {
        return res.status(404).json({ message: 'Audit issue not found' });
      }
      res.status(200).json(issue);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load audit issue', error: error.message });
    }
  },

  getKeywordsSummary: async (req, res) => {
    try {
      const data = await seoService.getKeywordsSummary(siteUrlFromReq(req));
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load keywords summary', error: error.message });
    }
  },

  getKeywords: async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const data = await seoService.listKeywords(siteUrlFromReq(req), {
        tab: req.query.tab || 'tracked',
        search: req.query.search || '',
        page,
        limit,
      });
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load keywords', error: error.message });
    }
  },

  getTopSearchKeywords: async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 10;
      const data = await getTopSearchKeywords({
        preset: req.query.preset,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        limit,
      });
      res.status(200).json(data);
    } catch (error) {
      const status = error.message.includes('not enabled')
        || error.message.includes('not configured')
        || error.message.includes('must be')
        || error.message.includes('Invalid date')
        || error.message.includes('startDate')
        || error.message.includes('preset')
        ? 400
        : 500;
      res.status(status).json({
        message: 'Failed to load top search keywords',
        error: error.message,
      });
    }
  },

  trackKeyword: async (req, res) => {
    try {
      const { keyword, targetUrl } = req.body;
      const data = await seoService.trackKeyword(siteUrlFromReq(req), { keyword, targetUrl });
      res.status(201).json({ message: 'Keyword tracked', keyword: data });
    } catch (error) {
      const status = error.message.includes('required') ? 400 : 500;
      res.status(status).json({ message: 'Failed to track keyword', error: error.message });
    }
  },

  deleteKeyword: async (req, res) => {
    try {
      const deleted = await seoService.deleteKeyword(siteUrlFromReq(req), req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: 'Keyword not found' });
      }
      res.status(200).json({ message: 'Keyword removed' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete keyword', error: error.message });
    }
  },

  triggerRefresh: async (req, res) => {
    try {
      const job = await seoService.runRefresh(siteUrlFromReq(req), req.user?._id || null);
      res.status(202).json({
        message: 'SEO refresh started',
        jobId: job._id.toString(),
        status: job.status,
      });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: 'Failed to start refresh', error: error.message });
    }
  },

  getRefreshStatus: async (req, res) => {
    try {
      const snapshot = await seoService.getOrCreateSnapshot(siteUrlFromReq(req));
      const jobId = req.query.jobId || snapshot.refreshJobId;
      const job = await seoService.getRefreshJobStatus(jobId);
      if (!job) {
        return res.status(404).json({ message: 'Refresh job not found' });
      }
      res.status(200).json({
        jobId: job._id.toString(),
        status: job.status,
        progress: job.progress,
        stats: job.stats,
        errorMessage: job.errorMessage,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to load refresh status', error: error.message });
    }
  },

  getCompetitors: async (req, res) => {
    try {
      const data = await competitorService.getCompetitorsOverview(siteUrlFromReq(req));
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load competitors', error: error.message });
    }
  },

  addCompetitor: async (req, res) => {
    try {
      const { name, url, competitorUrl } = req.body;
      const competitor = await competitorService.addCompetitor(siteUrlFromReq(req), {
        name,
        url: url || competitorUrl,
      });
      res.status(201).json({ message: 'Competitor added', competitor });
    } catch (error) {
      const status = error.statusCode || (error.message.includes('required') ? 400 : 500);
      res.status(status).json({ message: 'Failed to add competitor', error: error.message });
    }
  },

  deleteCompetitor: async (req, res) => {
    try {
      const deleted = await competitorService.deleteCompetitor(siteUrlFromReq(req), req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: 'Competitor not found' });
      }
      res.status(200).json({ message: 'Competitor removed' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete competitor', error: error.message });
    }
  },

  getContentGaps: async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const data = await competitorService.listContentGaps(siteUrlFromReq(req), {
        page,
        limit,
        status: req.query.status || 'open',
      });
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load content gaps', error: error.message });
    }
  },

  createPageFromContentGap: async (req, res) => {
    try {
      const author = req.user?.name || req.user?.email || 'SEO Assistant';
      const result = await competitorService.createPageFromContentGap(
        siteUrlFromReq(req),
        req.params.id,
        { author },
      );
      if (!result) {
        return res.status(404).json({ message: 'Content gap not found' });
      }
      const status = result.alreadyExists ? 200 : 201;
      res.status(status).json({
        message: result.alreadyExists
          ? 'Draft page already exists'
          : result.aiGenerated
            ? 'AI draft page created'
            : 'Draft page created',
        blogId: result.blog._id.toString(),
        blog: result.blog,
        gapId: result.gap._id.toString(),
        aiGenerated: Boolean(result.aiGenerated),
        aiMeta: result.aiMeta || null,
      });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: 'Failed to create page from content gap', error: error.message });
    }
  },

  getAgentStatus: async (req, res) => {
    try {
      const data = seoAgentService.getAgentStatus();
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load SEO agent status', error: error.message });
    }
  },

  createBlogDraftFromIdea: async (req, res) => {
    try {
      const idea = String(req.body?.idea || '').trim();
      if (!idea) {
        return res.status(400).json({ message: 'Idea is required' });
      }
      const author = req.user?.name || req.user?.email || 'SEO Assistant';
      const result = await seoAgentService.createBlogDraftFromIdea({
        idea,
        title: req.body?.title,
        author,
      });
      res.status(201).json({
        message: 'AI draft page created',
        blogId: result.blog._id.toString(),
        blog: result.blog,
        aiGenerated: true,
        aiMeta: result.aiMeta,
      });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: 'Failed to create draft from idea', error: error.message });
    }
  },

  generateItemSeoDescription: async (req, res) => {
    try {
      if (!req.params.id || !/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
        return res.status(400).json({ message: 'Invalid item id' });
      }
      const result = await seoAgentService.generateItemSeoDescription(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({
        message: 'Failed to generate item description',
        error: error.message,
      });
    }
  },

  applyItemSeoDescription: async (req, res) => {
    try {
      if (!req.params.id || !/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
        return res.status(400).json({ message: 'Invalid item id' });
      }
      const description = String(req.body?.description || '').trim();
      if (!description) {
        return res.status(400).json({ message: 'Description is required' });
      }
      const result = await seoAgentService.applyItemSeoDescription({
        itemId: req.params.id,
        description,
        user: req.user,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.status(200).json({
        message: 'Item description saved',
        item: result.item,
      });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({
        message: 'Failed to save item description',
        error: error.message,
      });
    }
  },

  getIndexationSummary: async (req, res) => {
    try {
      const data = await indexationService.getSummary(siteUrlFromReq(req));
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load indexation summary', error: error.message });
    }
  },

  getIndexationPages: async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const data = await indexationService.listPages(siteUrlFromReq(req), {
        status: req.query.status || 'all',
        gscSignal: req.query.gscSignal || 'all',
        googleStatus: req.query.googleStatus || 'all',
        page,
        limit,
        search: req.query.search || '',
      });
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ message: 'Failed to load indexation pages', error: error.message });
    }
  },

  inspectIndexationPage: async (req, res) => {
    try {
      const page = await indexationService.inspectPageById(siteUrlFromReq(req), req.params.id);
      if (!page) {
        return res.status(404).json({ message: 'Indexation page not found' });
      }
      res.status(200).json({ message: 'URL inspected with Google Search Console', page });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: 'Failed to inspect URL', error: error.message });
    }
  },

  enrichAuditWithAgent: async (req, res) => {
    try {
      const result = await seoAgentService.enrichAuditIssues(siteUrlFromReq(req));
      res.status(200).json({
        message: 'Audit issues enriched with Claude',
        enriched: result.enriched,
        usage: result.usage,
        model: result.model,
        aiActionPlan: result.aiActionPlan,
      });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ message: 'Failed to enrich audit with agent', error: error.message });
    }
  },

  syncCompetitorMetrics: async (req, res) => {
    try {
      const result = await competitorService.syncCompetitorMetricsFromProvider(siteUrlFromReq(req));
      if (result.skipped) {
        return res.status(503).json({
          message: 'No free SEO metrics providers configured',
          hint: 'Set SEO_GSC_ENABLED=true and/or OPENPAGERANK_API_KEY in server .env',
          result,
        });
      }
      const overview = await competitorService.getCompetitorsOverview(siteUrlFromReq(req));
      res.status(200).json({
        message: 'Competitor metrics synced',
        synced: result.synced,
        total: result.total,
        provider: result.provider,
        ...overview,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to sync competitor metrics', error: error.message });
    }
  },
};

module.exports = seoCtrl;
