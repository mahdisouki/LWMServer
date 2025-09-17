const Storage = require('../models/Storage');
const StoragePlace = require('../models/StroragePlace');
const Truck = require('../models/Truck');
const capacities = require('../config/storageCapacities');

// Helper function to get current available quantities for each item type
const getCurrentQuantities = async () => {
  const totals = await Storage.aggregate([
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
              {
                $and: [
                  { $eq: ["$type", "add"] },
                  { $ne: ["$isReset", true] }
                ]
              },
              "$items.other",
              {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$type", "take"] },
                      { $ne: ["$isReset", true] }
                    ]
                  },
                  { $multiply: ["$items.other", -1] },
                  0
                ]
              }
            ],
          },
        },
      },
    },
  ]);

  if (!totals.length) {
    return {
      fridges: 0,
      mattresses: 0,
      sofas: 0,
      paint: 0,
      other: 0
    };
  }

  return {
    fridges: Math.max(0, totals[0].totalFridges || 0),
    mattresses: Math.max(0, totals[0].totalMattresses || 0),
    sofas: Math.max(0, totals[0].totalSofas || 0),
    paint: Math.max(0, totals[0].totalPaint || 0),
    other: Math.max(0, totals[0].totalOther || 0)
  };
};

const storageCtrl = {
  addItems: async (req, res) => {
    try {
      const { driverId, date, storagePlace } = req.body;

      // Parse the items JSON string
      let items;
      try {
        items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
      } catch (parseError) {
        console.error('Error parsing items JSON:', parseError);
        return res.status(400).json({ message: 'Invalid items format' });
      }

      console.log('Parsed items:', items); // Add this for debugging

      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);

      // Find the truck assigned to this driver
      const truck = await Truck.findOne({ driverId });
      if (!truck) {
        return res.status(404).json({ message: 'No truck assigned to this driver' });
      }

      const proofUrls = req.files ? req.files.map((file) => file.path) : [];

      const newStorageRecord = new Storage({
        driverId,
        helperId: truck.helperId,
        truckId: truck._id,
        type: 'add',
        date: storageDate,
        items: {
          fridges: items.fridges || 0,
          mattresses: items.mattresses || 0,
          sofas: items.sofas || 0,
          paint: items.paint || 0,
          other: (() => {
            const v = parseFloat(items.other);
            return Number.isFinite(v) && v >= 0 ? v : 0;
          })(),
        },
        storagePlace: storagePlace,
        proofs: proofUrls,
      });

      const savedStorage = await newStorageRecord.save();
      console.log(savedStorage)
      res
        .status(201)
        .json({ message: 'Items added to storage', storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  removeItems: async (req, res) => {
    try {
      const { driverId, date } = req.body;

      // Parse the items JSON string - ADD THIS PART
      let items;
      try {
        items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
      } catch (parseError) {
        console.error('Error parsing items JSON:', parseError);
        return res.status(400).json({ message: 'Invalid items format' });
      }

      console.log('Parsed items:', items); // Add this for debugging

      // Get current available quantities
      const currentQuantities = await getCurrentQuantities();

      // Validate that we have enough items to remove
      const itemsToRemove = {
        fridges: items.fridges || 0,
        mattresses: items.mattresses || 0,
        sofas: items.sofas || 0,
        paint: items.paint || 0,
        other: (() => {
          const v = parseFloat(items.other);
          return Number.isFinite(v) && v >= 0 ? v : 0;
        })(),
      };

      // Check if any removal quantity exceeds available quantity
      const validationErrors = {};
      let hasErrors = false;

      if (itemsToRemove.fridges > currentQuantities.fridges) {
        validationErrors.fridges = {
          requested: itemsToRemove.fridges,
          available: currentQuantities.fridges,
          message: `Cannot remove ${itemsToRemove.fridges} fridges. Only ${currentQuantities.fridges} available.`
        };
        hasErrors = true;
      }

      if (itemsToRemove.mattresses > currentQuantities.mattresses) {
        validationErrors.mattresses = {
          requested: itemsToRemove.mattresses,
          available: currentQuantities.mattresses,
          message: `Cannot remove ${itemsToRemove.mattresses} mattresses. Only ${currentQuantities.mattresses} available.`
        };
        hasErrors = true;
      }

      if (itemsToRemove.sofas > currentQuantities.sofas) {
        validationErrors.sofas = {
          requested: itemsToRemove.sofas,
          available: currentQuantities.sofas,
          message: `Cannot remove ${itemsToRemove.sofas} sofas. Only ${currentQuantities.sofas} available.`
        };
        hasErrors = true;
      }

      if (itemsToRemove.paint > currentQuantities.paint) {
        validationErrors.paint = {
          requested: itemsToRemove.paint,
          available: currentQuantities.paint,
          message: `Cannot remove ${itemsToRemove.paint} paint. Only ${currentQuantities.paint} available.`
        };
        hasErrors = true;
      }

      if (itemsToRemove.other > currentQuantities.other) {
        validationErrors.other = {
          requested: itemsToRemove.other,
          available: currentQuantities.other,
          message: `Cannot remove ${itemsToRemove.other} other items. Only ${currentQuantities.other} available.`
        };
        hasErrors = true;
      }

      // If there are validation errors, return them
      if (hasErrors) {
        return res.status(422).json({
          message: 'Insufficient quantity in storage',
          validationErrors: validationErrors,
          availableQuantities: currentQuantities
        });
      }

      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);

      // Find the truck assigned to this driver
      const truck = await Truck.findOne({ driverId });
      if (!truck) {
        return res.status(404).json({ message: 'No truck assigned to this driver' });
      }

      const proofUrls = req.files ? req.files.map((file) => file.path) : [];

      const newStorageRecord = new Storage({
        driverId,
        helperId: truck.helperId,
        truckId: truck._id,
        type: 'take',
        date: storageDate,
        items: itemsToRemove,
        proofs: proofUrls,
      });

      const savedStorage = await newStorageRecord.save();
      console.log("removed", savedStorage)

      res
        .status(201)
        .json({ message: 'Items removed from storage', storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
  updateStorageById: async (req, res) => {
    try {
      const { id } = req.params;

      const updates = {};
      console.log("REQ BODY:", req.body);

      if (req.body.driverId) updates.driverId = req.body.driverId;
      if (req.body.type) updates.type = req.body.type;
      if (req.body.notes) updates.notes = req.body.notes;
      if (req.body.storagePlace) updates.storagePlace = req.body.storagePlace;

      if (req.body.date) {
        const parsedDate = new Date(req.body.date);
        parsedDate.setHours(0, 0, 0, 0);
        updates.date = parsedDate;
      }

      const items = {};

      if ('fridges' in req.body) items.fridges = parseInt(req.body.fridges);
      if ('mattresses' in req.body) items.mattresses = parseInt(req.body.mattresses);
      if ('sofas' in req.body) items.sofas = parseInt(req.body.sofas);
      if ('paint' in req.body) items.paint = parseInt(req.body.paint);
      if ('other' in req.body) {
        items.other = req.body.other;
      }

      if (Object.keys(items).length > 0) {
        updates.items = items;
      }

      if (req.files && req.files.length > 0) {
        updates.proofs = req.files.map(file => file.path);
      }

      const updatedStorage = await Storage.findByIdAndUpdate(id, updates, { new: true });

      if (!updatedStorage) {
        return res.status(404).json({ message: "Storage record not found" });
      }

      res.status(200).json({
        message: "Storage record updated successfully",
        storage: updatedStorage,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
  getAllStorages: async (req, res) => {
    try {
      const { driverId, storagePlace, page = 1, limit } = req.query;

      const query = {};
      if (driverId) query.driverId = driverId;
      if (storagePlace) query.storagePlace = storagePlace;

      const skip = (Number(page) - 1) * Number(limit);

      const storagesQuery = Storage.find(query)
        .populate('driverId storagePlace truckId helperId')
        .skip(skip)
        .limit(Number(limit))
        .sort({ date: -1, _id: -1 });

      const [storages, total] = await Promise.all([
        storagesQuery.exec(),
        Storage.countDocuments(query),
      ]);

      return res.status(200).json({
        message: 'Storages fetched successfully',
        storages,
        meta: {
          currentPage: Number(page),
          limit: Number(limit),
          total,
          count: storages.length,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  getStoragesByDate: async (req, res) => {
    try {
      const { date, driverId, storagePlace, page = 1, limit = 9 } = req.query;

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
      if (storagePlace) query.storagePlace = storagePlace;
      const storagesQuery = Storage.find(query).populate('driverId storagePlace truckId helperId');
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
      const totals = await Storage.aggregate([
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
                  {
                    $and: [
                      { $eq: ["$type", "add"] },
                      { $ne: ["$isReset", true] } // Only count non-reset records for rubbish
                    ]
                  },
                  "$items.other",
                  {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$type", "take"] },
                          { $ne: ["$isReset", true] } // Only count non-reset records for rubbish
                        ]
                      },
                      { $multiply: ["$items.other", -1] },
                      0 // Don't count reset records
                    ]
                  }
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

      const clampPercent = (value) => {
        if (!Number.isFinite(value)) return null;
        const clamped = Math.min(100, Math.max(0, value));
        return Math.round(clamped * 100) / 100; // 2 decimals
      };

      const percentFull = {
        fridges:
          capacities.fridges && capacities.fridges > 0
            ? clampPercent((netItems.totalFridges / capacities.fridges) * 100)
            : null,
        mattresses:
          capacities.mattresses && capacities.mattresses > 0
            ? clampPercent((netItems.totalMattresses / capacities.mattresses) * 100)
            : null,
        sofas:
          capacities.sofas && capacities.sofas > 0
            ? clampPercent((netItems.totalSofas / capacities.sofas) * 100)
            : null,
        paint:
          capacities.paint && capacities.paint > 0
            ? clampPercent((netItems.totalPaint / capacities.paint) * 100)
            : null,
        other:
          capacities.other && capacities.other > 0
            ? clampPercent((netItems.totalOther / capacities.other) * 100)
            : null,
      };

      res.status(200).json({
        message: "Total items in storage fetched successfully",
        totalItems: {
          fridges: netItems.totalFridges,
          mattresses: netItems.totalMattresses,
          sofas: netItems.totalSofas,
          paint: netItems.totalPaint,
          other: netItems.totalOther,
        },
        capacities,
        percentFull,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Reset the accumulated 'other' (rubbish) quantity by marking existing records as historical
  resetOtherQuantity: async (req, res) => {
    try {
      // Compute current net 'other' across non-reset records only (before reset)
      const totals = await Storage.aggregate([
        {
          $match: { isReset: { $ne: true } } // Only consider non-reset records
        },
        {
          $group: {
            _id: null,
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

      const netOther = totals.length ? totals[0].totalOther : 0;

      // Mark all existing records as reset (historical) - this preserves their data
      const result = await Storage.updateMany(
        { isReset: { $ne: true } },
        { $set: { isReset: true } }
      );

      return res.status(200).json({
        message: 'Rubbish (other) quantities reset - historical records preserved, new calculations will start from zero',
        previousNetOther: netOther,
        historicalRecordsMarked: result.matchedCount ?? result.nMatched,
        modified: result.modifiedCount ?? result.nModified,
        note: 'All existing records are now marked as historical. New records will start fresh rubbish calculations.'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getTotalItemsGroupedByStoragePlace: async (req, res) => {
    try {
      const totals = await Storage.aggregate([
        {
          $group: {
            _id: "$storagePlace", // group by storagePlace ID
            totalFridges: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.fridges",
                  { $multiply: ["$items.fridges", -1] }
                ]
              }
            },
            totalMattresses: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.mattresses",
                  { $multiply: ["$items.mattresses", -1] }
                ]
              }
            },
            totalSofas: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.sofas",
                  { $multiply: ["$items.sofas", -1] }
                ]
              }
            },
            totalPaint: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "add"] },
                  "$items.paint",
                  { $multiply: ["$items.paint", -1] }
                ]
              }
            },
            totalOther: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$type", "add"] },
                      { $ne: ["$isReset", true] } // Only count non-reset records for rubbish
                    ]
                  },
                  "$items.other",
                  {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$type", "take"] },
                          { $ne: ["$isReset", true] } // Only count non-reset records for rubbish
                        ]
                      },
                      { $multiply: ["$items.other", -1] },
                      0 // Don't count reset records
                    ]
                  }
                ]
              }
            }
          }
        },
        {
          $lookup: {
            from: "storageplaces", // collection name (lowercase plural of model)
            localField: "_id",
            foreignField: "_id",
            as: "storagePlace"
          }
        },
        {
          $unwind: {
            path: "$storagePlace",
            preserveNullAndEmptyArrays: true
          }
        }
      ]);

      res.status(200).json({
        message: "Total items grouped by storage place",
        data: totals.map(item => ({
          storagePlaceId: item._id,
          storagePlaceName: item.storagePlace?.name || "Unknown",
          totals: {
            fridges: item.totalFridges,
            mattresses: item.totalMattresses,
            sofas: item.totalSofas,
            paint: item.totalPaint,
            other: item.totalOther,
          }
        }))
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get storages by userId (matches either driverId or helperId)
  getStoragesByUserId: async (req, res) => {
    try {
      const { userId } = req.params;
      const { date, page = 1, limit = 10 } = req.query;

      const query = {
        $or: [{ driverId: userId }, { helperId: userId }],
      };

      if (date) {
        const inputDate = new Date(date);
        const startOfDay = new Date(inputDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(inputDate);
        endOfDay.setHours(23, 59, 59, 999);
        query.date = { $gte: startOfDay, $lte: endOfDay };
      }

      const skip = (Number(page) - 1) * Number(limit);
      const storagesQuery = Storage.find(query)
        .populate('driverId helperId truckId storagePlace')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const [storages, total] = await Promise.all([
        storagesQuery.exec(),
        Storage.countDocuments(query),
      ]);

      return res.status(200).json({
        message: 'Storages fetched successfully',
        storages,
        meta: {
          currentPage: Number(page),
          limit: Number(limit),
          total,
          count: storages.length,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, address, location, capacity } = req.body;
      const image = req.file?.path || '';

      const newPlace = new StoragePlace({
        name,
        address,
        location,
        image,
        capacity,
        availableCapacity: capacity, // initially full
      });

      await newPlace.save();
      res.status(201).json({ message: 'Storage place created', data: newPlace });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getAll: async (req, res) => {
    try {
      const places = await StoragePlace.find();
      res.status(200).json({ data: places });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  getOne: async (req, res) => {
    try {
      const place = await StoragePlace.findById(req.params.id);
      if (!place) return res.status(404).json({ message: 'Not found' });
      res.status(200).json({ data: place });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  update: async (req, res) => {
    try {
      const updates = req.body;
      if (req.file) updates.image = req.file.path;

      const updated = await StoragePlace.findByIdAndUpdate(req.params.id, updates, { new: true });
      if (!updated) return res.status(404).json({ message: 'Not found' });

      res.status(200).json({ message: 'Updated', data: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },

  delete: async (req, res) => {
    try {
      const deleted = await StoragePlace.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ message: 'Not found' });
      res.status(200).json({ message: 'Deleted successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
  // Delete a storage record by ID
  deleteStorageRecord: async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await Storage.findByIdAndDelete(id);
      if (!deleted) return res.status(404).json({ message: 'Storage record not found' });
      res.status(200).json({ message: 'Storage record deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
};

module.exports = storageCtrl;
