const Storage = require("../models/Storage");



const storageCtrl = {
  addItems: async (req, res) => {
    try {
      const { driverId, date, items } = req.body;
      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);
  
      const proofUrls = req.files ? req.files.map(file => file.path) : [];
  
      const newStorageRecord = new Storage({
        driverId,
        type: "add",
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
      res.status(201).json({ message: "Items added to storage", storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  removeItems: async (req, res) => {
    try {
      const { driverId, date, items } = req.body;
      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);
  
      const proofUrls = req.files ? req.files.map(file => file.path) : [];
  
      const newStorageRecord = new Storage({
        driverId,
        type: "take",
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
      res.status(201).json({ message: "Items removed from storage", storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },
  getStoragesByDate: async (req, res) => {
    try {
      const { date, driverId } = req.query;

      if (!date) {
        return res.status(400).json({ message: "Date is required" });
      }

      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0); // Normalize the date to midnight

      // If a driverId is provided, filter by driverId as well
      const query = { date: storageDate };
      if (driverId) query.driverId = driverId;

      const storages = await Storage.find(query)
        .populate("driverId", "username email") // Populate driver info if needed
        .exec();

      if (!storages.length) {
        return res.status(404).json({ message: "No storage records found for the specified date" });
      }

      res.status(200).json({ storages });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = storageCtrl;
