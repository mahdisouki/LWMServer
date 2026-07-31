const StandardItem = require('../../models/StandardItem');

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

const BAR_COLORS = [
  'green', 'blue', 'purple', 'orange', 'pink', 'cyan', 'amber', 'indigo',
  'teal', 'lime', 'rose', 'violet', 'sky', 'emerald', 'fuchsia', 'red',
];

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Popular items from stored StandardItem popularity fields
 * (purchasedCount / timesPurchased), refreshed by the popularity cron —
 * not live-aggregated per analytics date range.
 */
async function getPopularItems({ limit = DEFAULT_LIMIT } = {}) {
  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const topItems = await StandardItem.find({
    purchasedCount: { $gt: 0 },
  })
    .select('itemName image purchasedCount timesPurchased popularityUpdatedAt')
    .sort({ purchasedCount: -1, timesPurchased: -1, itemName: 1 })
    .limit(rowLimit)
    .lean();

  const maxQuantity = topItems[0]?.purchasedCount || 0;
  const latestUpdate = topItems.reduce((latest, item) => {
    if (!item.popularityUpdatedAt) return latest;
    if (!latest || item.popularityUpdatedAt > latest) return item.popularityUpdatedAt;
    return latest;
  }, null);

  const items = topItems.map((item, index) => ({
    rank: index + 1,
    itemKey: String(item._id),
    itemId: String(item._id),
    itemName: item.itemName,
    image: item.image || null,
    quantity: item.purchasedCount || 0,
    orders: item.timesPurchased || 0,
    sharePercent: maxQuantity > 0
      ? roundPercent(((item.purchasedCount || 0) / maxQuantity) * 100)
      : 0,
    color: BAR_COLORS[index % BAR_COLORS.length],
  }));

  const totals = items.reduce(
    (acc, row) => ({
      quantity: acc.quantity + row.quantity,
      orders: acc.orders + row.orders,
    }),
    { quantity: 0, orders: 0 },
  );

  return {
    badge: {
      label: 'Stored all-time',
      icon: 'inventory',
    },
    items,
    totals,
    popularityUpdatedAt: latestUpdate ? latestUpdate.toISOString() : null,
    dateFilterApplied: false,
    limit: rowLimit,
    dataSources: {
      items:
        'StandardItem.purchasedCount / timesPurchased — stored popularity scores (cron via popularityService), excluding createdBy MigrationScript orders, not filtered by analytics date range',
      ranking: 'Ranked by purchasedCount (all-time quantity), then timesPurchased',
    },
  };
}

module.exports = {
  getPopularItems,
};
