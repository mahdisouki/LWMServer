const Message = require('../models/Message');
const Truck = require('../models/Truck');
const { User } = require('../models/User');

module.exports = {
  //---> get messages for a driver
  getMessagesWithHelper: async (req, res) => {
    const driverId = req.user.id;

    try {
      const helperId = await getHelperIdForDriver(driverId);

      if (!helperId) {
        return res
          .status(404)
          .json({ message: 'Helper not found for this driver' });
      }

      const roomId = [driverId, helperId].sort().join('_');

      const messages = await Message.find({ roomId }).sort({ createdAt: 1 });

      res.status(200).json({ messages });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get messages with helper',
        error: error.message,
      });
    }
  },

  //---> get messages for a helper
  getMessagesWithDriver: async (req, res) => {
    const helperId = req.user.id;

    try {
      const driverId = await getDriverIdForHelper(helperId);

      if (!driverId) {
        return res
          .status(404)
          .json({ message: 'Driver not found for this helper' });
      }

      const roomId = [helperId, driverId].sort().join('_');

      const messages = await Message.find({ roomId }).sort({ createdAt: 1 });

      res.status(200).json({ messages });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get messages with driver',
        error: error.message,
      });
    }
  },

  //---> get messages for an admin
  getMessagesWithAdmin: async (req, res) => {
    const userId = req.user.id;

    try {
      const adminId = await getAdminId();

      if (!adminId) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      const roomId = [userId, adminId].sort().join('_');

      const messages = await Message.find({ roomId }).sort({ createdAt: 1 });

      res.status(200).json({ messages });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get messages with admin',
        error: error.message,
      });
    }
  },

  //---> get the helper assigned to a driver
  getAssignedHelper: async (req, res) => {

    const truck = await Truck.findById('66ddb2a86d3115e1ab9dcfec');
    truck.driverId = req.user.id;
    truck.helperId = '66f3de99e55b4714e2997b45';
    await truck.save();

    const driverId = req.user.id;
    try {
      const truck = await Truck.findOne({ driverId });
      if (!truck || !truck.helperId) {
        return res
          .status(404)
          .json({ message: 'No helper assigned to this driver' });
      }
      res.status(200).json({ helperId: truck.helperId });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get assigned helper',
        error: error.message,
      });
    }
  },

  //---> get the driver assigned to a helper
  getAssignedDriver: async (req, res) => {
    const helperId = req.user.id;
    try {
      const truck = await Truck.findOne({ helperId });
      if (!truck || !truck.driverId) {
        return res
          .status(404)
          .json({ message: 'No driver assigned to this helper' });
      }
      res.status(200).json({ driverId: truck.driverId });
    } catch (error) {
      res.status(500).json({
        message: 'Failed to get assigned driver',
        error: error.message,
      });
    }
  },

  //---> get the admin id
  getAdminId: async (_, res) => {
    try {
      const admin = await User.findOne({ roleType : 'Admin' });
      return admin
        ? res.status(200).json({ adminId: admin.id })
        : res.status(500).json({
            message: 'Failed to get admin id',
          });
    } catch (error) {
      return res.status(500).json({
        message: 'An error occurred while getting the admin id',
        error: error.message,
      });
    }
  },
};