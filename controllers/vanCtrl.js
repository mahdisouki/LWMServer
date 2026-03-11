const Van = require('../models/Van');
const APIfeatures = require('../utils/APIFeatures');

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