const Storage = require("../models/Storage");



const storageCtrl = {
  addItems: async (req, res) => {
    try {
      const { driverId, date, items } = req.body;
      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);

      let storageRecord = await Storage.findOne({ driverId, date: storageDate });

      if (storageRecord) {
        storageRecord.items.fridges += items.fridges || 0;
        storageRecord.items.mattresses += items.mattresses || 0;
        storageRecord.items.sofas += items.sofas || 0;
        storageRecord.items.paint += items.paint || 0;
        storageRecord.items.other += items.other || 0;
      } else {
        storageRecord = new Storage({
          driverId,
          type:"add",
          date: storageDate,
          items: {
            fridges: items.fridges || 0,
            mattresses: items.mattresses || 0,
            sofas: items.sofas || 0,
            paint: items.paint || 0,
            other: items.other || 0,
          }
        });
      }

      if (req.files) {
        const proofUrls = req.files.map(file => file.path);  
        storageRecord.proofs = [...storageRecord.proofs, ...proofUrls]; 
      }

      const savedStorage = await storageRecord.save();
      res.status(200).json({ message: "Items added to storage", storage: savedStorage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  removeItems: async (req, res) => {
    try {
      const { driverId, date, items } = req.body;
      const storageDate = new Date(date);
      storageDate.setHours(0, 0, 0, 0);

      let storageRecord = await Storage.findOne({ driverId, date: storageDate });

      if (!storageRecord) {
        return res.status(404).json({ message: "No storage record found for the specified date and driver" });
      }
      storageRecord.type= "take";
      storageRecord.items.fridges = Math.max(0, storageRecord.items.fridges - (items.fridges || 0));
      storageRecord.items.mattresses = Math.max(0, storageRecord.items.mattresses - (items.mattresses || 0));
      storageRecord.items.sofas = Math.max(0, storageRecord.items.sofas - (items.sofas || 0));
      storageRecord.items.paint = Math.max(0, storageRecord.items.paint - (items.paint || 0));
      storageRecord.items.other = Math.max(0, storageRecord.items.other - (items.other || 0));

      if (req.body.proofsToRemove) {
        storageRecord.proofs = storageRecord.proofs.filter(proof => !req.body.proofsToRemove.includes(proof));
      }

      const updatedStorage = await storageRecord.save();
      res.status(200).json({ message: "Items removed from storage", storage: updatedStorage });
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
