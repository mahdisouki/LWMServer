const StandardItem = require('../models/StandardItem');
const ServiceCategory = require('../models/ServiceCategory');
const Task = require('../models/Task');

const POPULARITY_STALE_MS = 35 * 24 * 60 * 60 * 1000;

const paidTaskItemMatch = {
  paymentStatus: { $in: ['Paid', 'partial_Paid'] },
  taskStatus: { $ne: 'Cancelled' },
  'items.standardItemId': { $ne: null },
};

async function aggregateItemPopularity() {
  return Task.aggregate([
    { $match: paidTaskItemMatch },
    { $unwind: '$items' },
    { $match: { 'items.standardItemId': { $ne: null } } },
    {
      $group: {
        _id: '$items.standardItemId',
        purchasedCount: {
          $sum: {
            $cond: [{ $gt: ['$items.quantity', 0] }, '$items.quantity', 1],
          },
        },
        timesPurchased: { $sum: 1 },
      },
    },
  ]);
}

async function aggregateCategoryPopularity() {
  return Task.aggregate([
    { $match: paidTaskItemMatch },
    { $unwind: '$items' },
    { $match: { 'items.standardItemId': { $ne: null } } },
    {
      $lookup: {
        from: StandardItem.collection.name,
        localField: 'items.standardItemId',
        foreignField: '_id',
        as: 'itemDoc',
      },
    },
    { $unwind: '$itemDoc' },
    { $unwind: '$itemDoc.category' },
    {
      $group: {
        _id: '$itemDoc.category',
        purchasedCount: {
          $sum: {
            $cond: [{ $gt: ['$items.quantity', 0] }, '$items.quantity', 1],
          },
        },
        timesPurchased: { $sum: 1 },
      },
    },
  ]);
}

async function isPopularityStale() {
  const cutoff = new Date(Date.now() - POPULARITY_STALE_MS);
  const recent = await StandardItem.findOne({
    popularityUpdatedAt: { $gte: cutoff },
  })
    .select('_id')
    .lean();

  return !recent;
}

async function updatePopularityScores() {
  const now = new Date();
  const [itemPopularity, categoryPopularity] = await Promise.all([
    aggregateItemPopularity(),
    aggregateCategoryPopularity(),
  ]);

  const itemPopularityMap = new Map(
    itemPopularity.map((entry) => [String(entry._id), entry]),
  );
  const categoryPopularityMap = new Map(
    categoryPopularity.map((entry) => [String(entry._id), entry]),
  );

  const allItems = await StandardItem.find().select('_id').lean();
  const itemBulkOps = allItems.map((item) => {
    const stats = itemPopularityMap.get(String(item._id));
    return {
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            purchasedCount: stats?.purchasedCount || 0,
            timesPurchased: stats?.timesPurchased || 0,
            popularityUpdatedAt: now,
          },
        },
      },
    };
  });

  const allCategories = await ServiceCategory.find().select('_id').lean();
  const categoryBulkOps = allCategories.map((category) => {
    const stats = categoryPopularityMap.get(String(category._id));
    return {
      updateOne: {
        filter: { _id: category._id },
        update: {
          $set: {
            purchasedCount: stats?.purchasedCount || 0,
            timesPurchased: stats?.timesPurchased || 0,
            popularityUpdatedAt: now,
          },
        },
      },
    };
  });

  if (itemBulkOps.length) {
    await StandardItem.bulkWrite(itemBulkOps);
  }
  if (categoryBulkOps.length) {
    await ServiceCategory.bulkWrite(categoryBulkOps);
  }

  return {
    itemsUpdated: itemBulkOps.length,
    categoriesUpdated: categoryBulkOps.length,
    itemsWithSales: itemPopularity.length,
    categoriesWithSales: categoryPopularity.length,
    updatedAt: now,
  };
}

module.exports = {
  updatePopularityScores,
  isPopularityStale,
  POPULARITY_STALE_MS,
};
