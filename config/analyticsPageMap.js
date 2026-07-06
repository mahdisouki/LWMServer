/**
 * Maps backoffice page filter labels to URL path patterns on the public site.
 * Patterns are tested against URL pathname (case-insensitive).
 */
const QUOTE_PAGE_ID = 'request-a-quote';

const PAGE_FILTERS = [
  { id: 'all', label: 'All Pages', pathLabel: '/', pathPatterns: [], tracksQuotes: true },
  { id: 'home', label: 'Home', pathLabel: '/', pathPatterns: ['^/$'], tracksQuotes: false },
  {
    id: 'waste-removal-services',
    label: 'Waste Removal Services',
    pathLabel: '/services/',
    pathPatterns: ['^/services/?$'],
    tracksQuotes: false,
  },
  {
    id: QUOTE_PAGE_ID,
    label: 'Request A Quote',
    pathLabel: '/order-checkout/',
    pathPatterns: ['^/order-checkout', '^/request-a-quote', '^/quote'],
    tracksQuotes: true,
  },
  {
    id: 'moving-services',
    label: 'Moving Services',
    pathLabel: '/moving/',
    pathPatterns: ['^/moving', '^/product-category/moving'],
    tracksQuotes: false,
  },
  {
    id: 'commercial-waste',
    label: 'Commercial Waste',
    pathLabel: '/commercial/',
    pathPatterns: ['^/commercial', '^/product-category/commercial'],
    tracksQuotes: false,
  },
  { id: 'blogs', label: 'Blogs', pathLabel: '/blog/', pathPatterns: ['^/blog'], tracksQuotes: false },
  { id: 'faq', label: 'FAQ', pathLabel: '/faq/', pathPatterns: ['^/faq'], tracksQuotes: false },
  { id: 'careers', label: 'Careers', pathLabel: '/careers/', pathPatterns: ['^/careers'], tracksQuotes: false },
];

function pageFilterTracksQuotes(pageFilter) {
  return Boolean(pageFilter?.tracksQuotes);
}

function getPageFilters() {
  return PAGE_FILTERS.map(({ id, label }) => ({ id, label }));
}

function getPageFilterById(pageId) {
  if (!pageId || pageId === 'all') {
    return PAGE_FILTERS[0];
  }
  return PAGE_FILTERS.find((p) => p.id === pageId) || null;
}

module.exports = {
  QUOTE_PAGE_ID,
  PAGE_FILTERS,
  getPageFilters,
  getPageFilterById,
  pageFilterTracksQuotes,
};
