const { buildCsvRow } = require('./csvFormat');

const VISIBLE_ITEMS_FILTER = { isHidden: { $ne: true } };

function formatPrice(price) {
  if (price == null || Number.isNaN(Number(price))) return '';
  return `£${Number(price).toFixed(2)}`;
}

function buildVisibleItemsCsv(items) {
  const lines = [
    buildCsvRow(['Name', 'Price']),
    ...items.map((item) =>
      buildCsvRow([item.itemName, formatPrice(item.price)]),
    ),
  ];
  return lines.join('\n');
}

module.exports = {
  VISIBLE_ITEMS_FILTER,
  buildVisibleItemsCsv,
};
