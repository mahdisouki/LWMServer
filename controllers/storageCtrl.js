const Storage = require('../models/Storage');

const storageCtrl = {
  addItems: async (req, res) => {
    try {
      const { driverId, date, items } = req.body;
      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);

      const proofUrls = req.files ? req.files.map((file) => file.path) : [];

      const newStorageRecord = new Storage({
        driverId,
        type: 'add',
        date: storageDate,
        items: {
          fridges: items.fridges || 0,
          mattresses: items.mattresses || 0,
          sofas: items.sofas || 0,
          paint: items.paint || 0,
          other: items.other || 0,
        },
        proofs: proofUrls,
      });

      const savedStorage = await newStorageRecord.save();
      res
        .status(201)
        .json({ message: 'Items added to storage', storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  removeItems: async (req, res) => {
    try {
      const { driverId, date, items } = req.body;
      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);

      const proofUrls = req.files ? req.files.map((file) => file.path) : [];

      const newStorageRecord = new Storage({
        driverId,
        type: 'take',
        date: storageDate,
        items: {
          fridges: items.fridges || 0,
          mattresses: items.mattresses || 0,
          sofas: items.sofas || 0,
          paint: items.paint || 0,
          other: items.other || 0,
        },
        proofs: proofUrls,
      });

      const savedStorage = await newStorageRecord.save();
      res
        .status(201)
        .json({ message: 'Items removed from storage', storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
  getStoragesByDate: async (req, res) => {
    try {
      const { date, driverId, page = 1, limit = 9 } = req.query;

      if (!date) {
        return res.status(400).json({ message: 'Date is required' });
      }

      const inputDate = new Date(date);
    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0); // Set to start of the day

    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999); // Set to end of the day

    // Construct the query
    const query = { date: { $gte: startOfDay, $lte: endOfDay } };


      if (driverId) query.driverId = driverId;

      const storagesQuery = Storage.find(query).populate('driverId'); 
      const total = await Storage.countDocuments();

      const skip = (page - 1) * limit;
      
      const storages = await storagesQuery
        .skip(skip)
        .limit(Number(limit))
        .exec();

      if (!storages.length) {
        return res
          .status(404)
          .json({ message: 'No storage records found for the specified date' });
      }
      console.log(storages)
      res.status(200).json({
        message: 'All storages fetched successfully',
        storages,
        meta: {
          currentPage: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          count: storages.length,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
  getTotalItemsInStorage: async (req, res) => {
    try {
      const { driverId } = req.query;

      // Optional filter by driverId
      const matchStage = driverId ? { driverId } : {};

      const totals = await Storage.aggregate([
        { $match: matchStage }, // Filter by driverId if provided
        {
          $group: {
            _id: null,
            totalFridges: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.fridges",
                  { $multiply: ["$items.fridges", -1] },
                ],
              },
            },
            totalMattresses: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.mattresses",
                  { $multiply: ["$items.mattresses", -1] },
                ],
              },
            },
            totalSofas: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.sofas",
                  { $multiply: ["$items.sofas", -1] },
                ],
              },
            },
            totalPaint: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.paint",
                  { $multiply: ["$items.paint", -1] },
                ],
              },
            },
            totalOther: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.other",
                  { $multiply: ["$items.other", -1] },
                ],
              },
            },
          },
        },
      ]);

      if (!totals.length) {
        return res.status(404).json({ message: "No storage records found" });
      }

      const netItems = totals[0]; // Aggregation returns an array

      res.status(200).json({
        message: "Total items in storage fetched successfully",
        totalItems: {
          fridges: netItems.totalFridges,
          mattresses: netItems.totalMattresses,
          sofas: netItems.totalSofas,
          paint: netItems.totalPaint,
          other: netItems.totalOther,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
};

module.exports = storageCtrl;
