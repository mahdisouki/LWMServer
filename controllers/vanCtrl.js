const Van = require('../models/Van');
const APIfeatures = require('../utils/APIFeatures');

function normalizeItemsInTruck(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((row) => ({
      item: String(row?.item ?? '').trim(),
      quantity: Math.max(0, Number(row?.quantity) || 0),
      spaceOfVan: Math.max(0, Number(row?.spaceOfVan) || 0),
    }))
    .filter((row) => row.item && (row.quantity > 0 || row.spaceOfVan > 0));
}

function parseCurrentCapacity(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.round(n * 100) / 100;
}

const vanCtrl = {
  createVan: async (req, res) => {
    try {
      const {matricule, fuelNumber, fuelLevel, loadCapacity, vanHire, insurance } = req.body;
      const newVan = new Van({
        matricule,
        fuelNumber,
        fuelLevel: fuelLevel ?? null,
        loadCapacity,
        vanHire: vanHire ?? 0,
        insurance: insurance ?? 0,
      });
      await newVan.save();

      res.status(201).json({ message: 'Van created successfully', van: newVan });
    } catch (error) {
      res.status(500).json({ message: 'Failed to create van', error: error.message });
    }
  },

  getAllVans: async (req, res) => {
    try {
      const { page = 1, limit = 20, keyword } = req.query;
      let query = Van.find();

      if (keyword) {
        query = query.find({
          $or: [
            { name: { $regex: keyword, $options: 'i' } },
            { matricule: { $regex: keyword, $options: 'i' } },
            { fuelNumber: { $regex: keyword, $options: 'i' } },
          ],
        });
      }

      const features = new APIfeatures(query, req.query);
      features.paginating();
      features.sorting();
      const vans = await features.query.exec();

      const total = await Van.countDocuments(
        keyword
          ? {
              $or: [
              
                { matricule: { $regex: keyword, $options: 'i' } },
                { fuelNumber: { $regex: keyword, $options: 'i' } },
              ],
            }
          : {}
      );

      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 10) || 20;

      res.status(200).json({
        message: 'All vans retrieved successfully',
        vans,
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: vans.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve vans',
        error: error.message,
      });
    }
  },

  getVanById: async (req, res) => {
    try {
      const { id } = req.params;
      const van = await Van.findById(id);
      if (!van) {
        return res.status(404).json({ message: 'Van not found' });
      }
      res.status(200).json({ message: 'Van retrieved successfully', van });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve van',
        error: error.message,
      });
    }
  },

  getVanItemsInTruck: async (req, res) => {
    try {
      const { id } = req.params;
      const van = await Van.findById(id)
        .select('itemsInTruck currentCapacity matricule')
        .lean();
      if (!van) {
        return res.status(404).json({ message: 'Van not found' });
      }
      res.status(200).json({
        message: 'Van items in truck retrieved successfully',
        itemsInTruck: van.itemsInTruck || [],
        currentCapacity: van.currentCapacity ?? 0,
        matricule: van.matricule,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve items in truck',
        error: error.message,
      });
    }
  },

  updateVanItemsInTruck: async (req, res) => {
    try {
      const { id } = req.params;
      const { currentCapacity, itemsInTruck } = req.body;

      const van = await Van.findById(id);
      if (!van) {
        return res.status(404).json({ message: 'Van not found' });
      }

      const update = {};

      if (itemsInTruck !== undefined) {
        update.itemsInTruck = normalizeItemsInTruck(itemsInTruck);
      }

      if (currentCapacity !== undefined) {
        const parsedCapacity = parseCurrentCapacity(currentCapacity);
        if (parsedCapacity === null) {
          return res.status(400).json({
            message: 'currentCapacity must be a non-negative number',
            error: 'INVALID_CURRENT_CAPACITY',
          });
        }
        update.currentCapacity = parsedCapacity;
      } else if (itemsInTruck !== undefined) {
        const itemsSum = update.itemsInTruck.reduce(
          (sum, row) => sum + (Number(row.spaceOfVan) || 0),
          0,
        );
        update.currentCapacity = Math.round(itemsSum * 100) / 100;
      }

      const updatedVan = await Van.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true },
      ).select('itemsInTruck currentCapacity matricule');

      res.status(200).json({
        message: 'Van load updated successfully',
        itemsInTruck: updatedVan.itemsInTruck || [],
        currentCapacity: updatedVan.currentCapacity ?? 0,
        matricule: updatedVan.matricule,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update van load',
        error: error.message,
      });
    }
  },

  updateVan: async (req, res) => {
    try {
      const { id } = req.params;
      const { matricule, fuelNumber, fuelLevel, loadCapacity, vanHire, insurance } = req.body;

      const oldVan = await Van.findById(id);
      if (!oldVan) {
        return res.status(404).json({ message: 'Van not found' });
      }

      const updatedVan = await Van.findByIdAndUpdate(
        id,
        {
         
          ...(matricule !== undefined && { matricule }),
          ...(fuelNumber !== undefined && { fuelNumber }),
          ...(fuelLevel !== undefined && { fuelLevel }),
          ...(loadCapacity !== undefined && { loadCapacity }),
          ...(vanHire !== undefined && { vanHire }),
          ...(insurance !== undefined && { insurance }),
        },
        { new: true }
      );

      res.status(200).json({ message: 'Van updated successfully', van: updatedVan });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to update van',
        error: error.message,
      });
    }
  },

  deleteVan: async (req, res) => {
    try {
      const { id } = req.params;
      const van = await Van.findById(id);
      if (!van) {
        return res.status(404).json({ message: 'Van not found' });
      }

      await Van.findByIdAndDelete(id);
      res.status(200).json({ message: 'Van deleted successfully' });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to delete van',
        error: error.message,
      });
    }
  },

  getVanMatricules: async (req, res) => {
    try {
      const matricules = (await Van.distinct('matricule')).sort();
      res.status(200).json({
        message: 'All van matricules retrieved successfully',
        matricules,
      });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to retrieve van matricules',
        error: error.message,
      });
    }
  },
};

module.exports = vanCtrl;