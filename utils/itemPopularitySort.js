const POPULARITY_NEAR_BUCKET_SIZE = 3;

const SORT_GROUPS = [
  { keys: ['lamp', 'cushion'], base: 100 },
  { keys: ['chair', 'armchair'], base: 200 },
  { keys: ['table', 'desk'], base: 300 },
  { keys: ['sofa'], base: 400 },
  { keys: ['bed', 'mattress'], base: 500 },
  { keys: ['wardrobe', 'drawer'], base: 600 },
  { keys: ['printer', 'tv'], base: 700 },
  { keys: ['fridge', 'freezer'], base: 800 },
  { keys: ['door', 'window', 'radiator'], base: 900 },
  { keys: ['load', 'bin'], base: 1000 },
];

const SIZE_ORDER = [
  ['mini', 1],
  ['small', 2],
  ['single', 2],
  ['standard', 3],
  ['medium', 3],
  ['double', 4],
  ['king', 5],
  ['emperor', 6],
  ['large', 7],
  ['corner', 8],
  ['american', 9],
  ['commercial', 10],
];

const toPopularityBucket = (purchasedCount) =>
  Math.floor((purchasedCount || 0) / POPULARITY_NEAR_BUCKET_SIZE);

const getItemSortOrder = (itemName) => {
  if (!itemName) return 99999;

  const name = itemName.toLowerCase();

  let base = 9000;
  for (const g of SORT_GROUPS) {
    if (g.keys.some((k) => name.includes(k))) {
      base = g.base;
      break;
    }
  }

  let size = 5;
  for (const [key, val] of SIZE_ORDER) {
    if (name.includes(key)) {
      size = val;
      break;
    }
  }

  const seaterMatch = name.match(/(\d+)\s*seater/);
  if (seaterMatch) {
    size = parseInt(seaterMatch[1], 10);
  }

  return base + size;
};

const getCreatedAtTime = (item) => {
  if (!item?.createdAt) return 0;
  return new Date(item.createdAt).getTime();
};

/**
 * Sort items using cached popularity fields (updated weekly by cron).
 * Falls back to createdAt when popularity is tied or zero.
 */
const sortItemsByPopularity = (items) => {
  return items.sort((a, b) => {
    const aPurchased = a.purchasedCount || 0;
    const bPurchased = b.purchasedCount || 0;

    const aBucket = toPopularityBucket(aPurchased);
    const bBucket = toPopularityBucket(bPurchased);
    if (bBucket !== aBucket) {
      return bBucket - aBucket;
    }

    const aOrder = getItemSortOrder(a.itemName);
    const bOrder = getItemSortOrder(b.itemName);
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    if (bPurchased !== aPurchased) {
      return bPurchased - aPurchased;
    }

    const aTimes = a.timesPurchased || 0;
    const bTimes = b.timesPurchased || 0;
    if (bTimes !== aTimes) {
      return bTimes - aTimes;
    }

    const nameCompare = (a.itemName || '').localeCompare(b.itemName || '');
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return getCreatedAtTime(b) - getCreatedAtTime(a);
  });
};

const defaultItemSort = { createdAt: -1, _id: 1 };

const popularityItemSort = {
  purchasedCount: -1,
  timesPurchased: -1,
  createdAt: -1,
  _id: 1,
};

const popularityCategorySort = {
  purchasedCount: -1,
  timesPurchased: -1,
  name: 1,
};

module.exports = {
  sortItemsByPopularity,
  defaultItemSort,
  popularityItemSort,
  popularityCategorySort,
};
