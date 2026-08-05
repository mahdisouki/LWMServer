/**
 * Maps backoffice page filter labels to URL path patterns on the public site
 * (client-lwm React Router routes).
 *
 * Waste Removal:
 * - Landing: /services/ (legacy /waste-removal* 301 here)
 * - Category listings: /product-category/:slug/ (separate row)
 * - Product detail: /product/:slug/ (separate row)
 *
 * pathLabel is the canonical URL shown in the analytics UI.
 * pageViewPatterns (when set) limits view/session metrics to the main landing page only.
 */
const QUOTE_PAGE_ID = 'request-a-quote';

// Top-level routes and legacy redirects — excluded from blog-detail slug matching.
const BLOG_SLUG_EXCLUDED_PREFIXES = [
  'services',
  'moving-services',
  'commercial-waste',
  'careers',
  'blogs',
  'blog',
  'faq',
  'contact-us',
  'contact',
  'quote',
  'terms-conditions',
  'privacy-policy',
  'cart',
  'order-checkout',
  'checkout',
  'feedback',
  'customer-review',
  'payment',
  'product-category',
  'product',
  'waste-removal-services',
  'waste-removal',
  'business',
].join('|');

const BLOG_DETAIL_PATTERN = `^/(?!${BLOG_SLUG_EXCLUDED_PREFIXES})(?:[^/]+)/?$`;

const PAGE_FILTERS = [
  { id: 'all', label: 'All Pages', pathLabel: '/', pathPatterns: [], tracksQuotes: true },
  { id: 'home', label: 'Home', pathLabel: '/', pathPatterns: ['^/$'], tracksQuotes: false },
  {
    id: 'waste-removal-services',
    label: 'Waste Removal Services',
    pathLabel: '/services/',
    // Landing only — matches client-lwm /services/ (legacy waste-removal* redirects here).
    // Do NOT include /product/ or /product-category/ (those inflate this row above site totals).
    pathPatterns: [
      '^/services/?$',
      '^/waste-removal-services/?$',
      '^/waste-removal/?$',
    ],
    pageViewPatterns: ['^/services/?$'],
    tracksQuotes: false,
  },
  {
    id: 'waste-removal-categories',
    label: 'Waste Removal Categories',
    pathLabel: '/product-category/',
    pathPatterns: ['^/product-category/[^/]+/?$'],
    tracksQuotes: false,
  },
  {
    id: 'waste-removal-products',
    label: 'Waste Removal Products',
    pathLabel: '/product/',
    pathPatterns: ['^/product/[^/]+/?$'],
    tracksQuotes: false,
  },
  {
    id: QUOTE_PAGE_ID,
    label: 'Request A Quote',
    pathLabel: '/quote/',
    pathPatterns: ['^/quote/?$'],
    pageViewPatterns: ['^/quote/?$'],
    tracksQuotes: true,
  },
  {
    id: 'orders',
    label: 'Orders',
    pathLabel: '/order-checkout/',
    pathPatterns: ['^/order-checkout/?$', '^/checkout/?$'],
    pageViewPatterns: ['^/order-checkout/?$', '^/checkout/?$'],
    tracksQuotes: false,
  },
  {
    id: 'moving-services',
    label: 'Moving Services',
    pathLabel: '/moving-services/',
    pathPatterns: ['^/moving-services/?$'],
    tracksQuotes: false,
  },
  {
    id: 'commercial-waste',
    label: 'Commercial Waste',
    pathLabel: '/commercial-waste/',
    pathPatterns: [
      '^/commercial-waste/?$',
      '^/business/?$',
    ],
    tracksQuotes: false,
  },
  {
    id: 'blogs',
    label: 'Blogs',
    pathLabel: '/blogs/',
    pathPatterns: [
      '^/blogs/?$',
      '^/blog/?$',
      BLOG_DETAIL_PATTERN,
    ],
    tracksQuotes: false,
  },
  { id: 'faq', label: 'FAQ', pathLabel: '/faq/', pathPatterns: ['^/faq/?$'], tracksQuotes: false },
  { id: 'careers', label: 'Careers', pathLabel: '/careers/', pathPatterns: ['^/careers/?$'], tracksQuotes: false },
  {
    id: 'contact-us',
    label: 'Contact',
    pathLabel: '/contact-us/',
    pathPatterns: [
      '^/contact-us/?$',
      '^/contact/?$',
    ],
    tracksQuotes: false,
  },
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

function getPageViewFilter(pageFilter) {
  if (!pageFilter || pageFilter.id === 'all' || !pageFilter.pageViewPatterns?.length) {
    return pageFilter;
  }
  return {
    ...pageFilter,
    pathPatterns: pageFilter.pageViewPatterns,
  };
}

module.exports = {
  QUOTE_PAGE_ID,
  PAGE_FILTERS,
  getPageFilters,
  getPageFilterById,
  getPageViewFilter,
  pageFilterTracksQuotes,
};
