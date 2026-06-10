/** Must match Python VALID_CATEGORIES exactly. */
const VALID_CATEGORY_SLUGS = new Set([
  'quote',
  'complaint',
  'order_confirmation',
  'update_order',
  'invoices',
  'careers',
  'moving_services',
  'other',
]);

const GMAIL_AI_CATEGORIES = [
  { slug: 'quote', label: 'Quote', order: 1 },
  { slug: 'moving_services', label: 'Moving Services', order: 2 },
  { slug: 'order_confirmation', label: 'Order Confirmation', order: 3 },
  { slug: 'update_order', label: 'Update Order', order: 4 },
  { slug: 'invoices', label: 'Invoices', order: 5 },
  { slug: 'complaint', label: 'Complaint', order: 6 },
  { slug: 'careers', label: 'Careers', order: 7 },
  { slug: 'other', label: 'Other', order: 99 },
];

const slugToLabel = new Map(
  GMAIL_AI_CATEGORIES.map((c) => [c.slug, c.label])
);

function getCategoryLabel(slug) {
  if (!slug) return null;
  return slugToLabel.get(slug) || slug.replace(/_/g, ' ');
}

function isValidCategorySlug(slug) {
  return VALID_CATEGORY_SLUGS.has(String(slug || '').trim().toLowerCase());
}

module.exports = {
  GMAIL_AI_CATEGORIES,
  VALID_CATEGORY_SLUGS,
  getCategoryLabel,
  isValidCategorySlug,
};
