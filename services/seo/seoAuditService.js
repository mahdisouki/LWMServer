function buildIssuesFromCrawl(crawlResult) {
  const { pages } = crawlResult;
  const issues = [];

  const missingTitle = pages.filter((p) => !p.title);
  if (missingTitle.length) {
    issues.push({
      issueKey: 'missing-title',
      title: 'Pages Missing Title Tag',
      severity: 'high',
      affectedUrls: missingTitle.map((p) => p.url),
      description: 'Pages without a <title> tag are harder for search engines to understand and rank.',
      impactSummary: 'Improves click-through and indexing clarity',
      expectedImprovement: 'Better SERP display and crawl understanding',
      aiFixSteps: [
        'Add a unique, descriptive <title> under 60 characters for each affected URL.',
        'Include primary keyword and brand where relevant.',
      ],
    });
  }

  const missingMeta = pages.filter((p) => !p.metaDescription);
  if (missingMeta.length) {
    issues.push({
      issueKey: 'missing-meta-description',
      title: 'Pages Missing Meta Description',
      severity: 'medium',
      affectedUrls: missingMeta.map((p) => p.url),
      description: 'Meta descriptions influence SERP snippets and click-through rates.',
      impactSummary: 'Higher CTR from search results',
      expectedImprovement: 'More qualified organic clicks',
      aiFixSteps: [
        'Write unique meta descriptions between 120–160 characters.',
        'Include a clear call-to-action for service pages.',
      ],
    });
  }

  const longTitles = pages.filter((p) => p.titleLength > 60);
  if (longTitles.length) {
    issues.push({
      issueKey: 'title-too-long',
      title: 'Title Tags Too Long',
      severity: 'low',
      affectedUrls: longTitles.map((p) => p.url),
      description: 'Titles over ~60 characters may be truncated in Google results.',
      impactSummary: 'Cleaner SERP presentation',
      expectedImprovement: 'Improved snippet display',
      aiFixSteps: ['Shorten titles to 50–60 characters while keeping the main keyword.'],
    });
  }

  const multipleH1 = pages.filter((p) => p.h1Count > 1);
  if (multipleH1.length) {
    issues.push({
      issueKey: 'multiple-h1',
      title: 'Multiple H1 Tags on Page',
      severity: 'medium',
      affectedUrls: multipleH1.map((p) => p.url),
      description: 'A single H1 per page helps clarify the main topic for search engines.',
      impactSummary: 'Clearer content hierarchy',
      expectedImprovement: 'Better on-page relevance signals',
      aiFixSteps: ['Keep one H1 per page; demote extra headings to H2/H3.'],
    });
  }

  const noH1 = pages.filter((p) => p.h1Count === 0);
  if (noH1.length) {
    issues.push({
      issueKey: 'missing-h1',
      title: 'Pages Missing H1',
      severity: 'medium',
      affectedUrls: noH1.map((p) => p.url),
      description: 'An H1 helps search engines identify the primary topic of the page.',
      impactSummary: 'Stronger topical relevance',
      expectedImprovement: 'Better alignment with target keywords',
      aiFixSteps: ['Add one descriptive H1 that matches the page intent and primary keyword.'],
    });
  }

  const indexedCheckout = pages.filter((p) => p.isCartOrCheckout && !p.hasNoindex);
  if (indexedCheckout.length) {
    issues.push({
      issueKey: 'cart-indexed',
      title: 'Cart & Checkout Pages Indexed',
      severity: 'critical',
      affectedUrls: indexedCheckout.map((p) => p.url),
      description: 'Transactional pages should usually be noindex to avoid thin/duplicate content in search.',
      impactSummary: '+25% qualified traffic potential',
      expectedImprovement: 'Less crawl budget wasted on non-landing URLs',
      aiFixSteps: [
        'Add <meta name="robots" content="noindex, nofollow"> to cart and checkout templates.',
        'Exclude these URLs in robots.txt if appropriate.',
        'Request removal in Google Search Console if already indexed.',
      ],
    });
  }

  const noindexPages = pages.filter((p) => p.hasNoindex);
  if (noindexPages.length) {
    issues.push({
      issueKey: 'noindex-pages',
      title: 'Pages Blocked with noindex',
      severity: 'low',
      affectedUrls: noindexPages.map((p) => p.url),
      description: 'These pages are marked noindex and will not appear in search results.',
      impactSummary: 'Informational — verify intentional',
      expectedImprovement: 'N/A',
      aiFixSteps: ['Confirm noindex is intentional for each URL; remove if the page should rank.'],
    });
  }

  return issues.map((issue) => ({
    ...issue,
    affectedPageCount: issue.affectedUrls.length,
  }));
}

function buildTechnicalChecks(crawlResult, coreWebVitals) {
  const { pages, errors, sitemapPageCount } = crawlResult;
  const withMeta = pages.filter((p) => p.metaDescription).length;
  const withTitle = pages.filter((p) => p.title).length;
  const httpsOk = pages.every((p) => p.url.startsWith('https://'));

  return [
    {
      id: 'https',
      title: 'HTTPS enabled',
      status: httpsOk ? 'pass' : 'fail',
      message: httpsOk ? 'All crawled URLs use HTTPS' : 'Some URLs are not served over HTTPS',
    },
    {
      id: 'sitemap',
      title: 'Sitemap discoverable',
      status: sitemapPageCount > 0 ? 'pass' : 'warn',
      message: sitemapPageCount > 0
        ? `${sitemapPageCount} URL(s) found in sitemap`
        : 'Could not fetch sitemap.xml',
    },
    {
      id: 'titles',
      title: 'Title tag coverage',
      status: pages.length && withTitle === pages.length ? 'pass' : withTitle > 0 ? 'warn' : 'fail',
      message: `${withTitle}/${pages.length} crawled pages have a title`,
    },
    {
      id: 'meta-descriptions',
      title: 'Meta description coverage',
      status: pages.length && withMeta === pages.length ? 'pass' : withMeta > 0 ? 'warn' : 'fail',
      message: `${withMeta}/${pages.length} crawled pages have a meta description`,
    },
    {
      id: 'crawl-errors',
      title: 'Crawl accessibility',
      status: errors.length === 0 ? 'pass' : errors.length < 3 ? 'warn' : 'fail',
      message: errors.length === 0
        ? 'All sitemap URLs responded successfully'
        : `${errors.length} URL(s) failed to crawl`,
    },
    {
      id: 'cwv-lcp',
      title: 'Largest Contentful Paint (LCP)',
      status: coreWebVitals.lcp.status === 'good' ? 'pass'
        : coreWebVitals.lcp.status === 'unknown' ? 'warn' : 'fail',
      message: coreWebVitals.lcp.displayValue === '—'
        ? 'Configure GOOGLE_PAGESPEED_API_KEY for live CWV data'
        : `Mobile LCP: ${coreWebVitals.lcp.displayValue}`,
    },
  ];
}

function buildAiActionPlan(issues) {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...issues]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 5)
    .map((issue) => ({
      priority: issue.severity === 'critical' || issue.severity === 'high' ? 'high' : 'medium',
      title: issue.title,
      description: issue.aiFixSteps?.[0] || issue.description,
    }));
}

function countBySeverity(issues) {
  return issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });
}

function computeSeoScore(issues, technicalChecks) {
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 15;
    else if (issue.severity === 'high') score -= 8;
    else if (issue.severity === 'medium') score -= 4;
    else score -= 2;
  }
  for (const check of technicalChecks) {
    if (check.status === 'fail') score -= 5;
    else if (check.status === 'warn') score -= 2;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreStatusFromScore(score) {
  if (score >= 80) return 'excellent';
  if (score >= 55) return 'good';
  return 'needs_work';
}

module.exports = {
  buildIssuesFromCrawl,
  buildTechnicalChecks,
  buildAiActionPlan,
  countBySeverity,
  computeSeoScore,
  scoreStatusFromScore,
};
