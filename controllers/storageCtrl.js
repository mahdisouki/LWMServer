const Storage = require('../models/Storage');
const StoragePlace = require('../models/StroragePlace');
const storageCtrl = {
  addItems: async (req, res) => {
    try {
      const { driverId, date, items , storagePlace  } = req.body;
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
        storagePlace ,
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
if ('other' in req.body) items.other = parseInt(req.body.other);

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
      const storagesQuery = Storage.find(query).populate('driverId storagePlace'); 
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
                  { $eq: ["$type", "add"] },
                  "$items.other",
                  { $multiply: ["$items.other", -1] }
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
};

module.exports = storageCtrl;
