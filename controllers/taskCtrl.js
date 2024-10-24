const Task = require("../models/Task");
const Truck = require("../models/Truck");
const APIfeatures = require("../utils/APIFeatures");

const taskCtrl = {
  createTask: async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        phoneNumber,
        location,
        date,
        hour,
        object,
        price,
        paymentStatus,
      } = req.body;

      const clientObjectPhotos = req.files.map((file) => file.path);

      const newTask = new Task({
        firstName,
        lastName,
        phoneNumber,
        location,
        clientObjectPhotos,
        date,
        hour,
        object,
        price,
        paymentStatus,
        taskStatus: "Processing",
      });

      await newTask.save();
      res
        .status(201)
        .json({ message: "Task created successfully", task: newTask });
    } catch (error) {
      res
        .status(400)
        .json({ message: "Failed to create task", error: error.message });
    }
  },
  getTaskById: async (req, res) => {
    const { taskId } = req.params;
    const tasks = await Task.find();
    console.log(tasks);
   
    tasks.forEach((task) => {
      task.truckId = '66ddb2a86d3115e1ab9dcfec';
      task.save();
    }
    );

    try {
      const task = await Task.findById(taskId);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      res.status(200).json({ message: "Task retrieved successfully", task });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve task", error: error.message });
    }
  },

  getAllTasks: async (req, res) => {
    try {
      const { page, limit, filters } = req.query;

      let query = Task.find();

      const features = new APIfeatures(query, req.query);

      if (filters) {
        features.filtering();
      }

      features.sorting().paginating();

      let tasks = await features.query.exec();
      const total = await Task.countDocuments(features.query);

      tasks = await Promise.all(
        tasks.map(async (task) => {
          if (task.truckId) {
            const truck = await Truck.findById(task.truckId);
            task = task.toObject();
            task.truckName = truck ? truck.name : null;
          }
          return task;
        })
      );

      const currentPage = parseInt(req.query.page, 10) || 1;
      const limitNum = parseInt(req.query.limit, 10) || 9;

      res.status(200).json({
        message: "All tasks retrieved successfully",
        tasks,
        meta: {
          currentPage,
          limit: limitNum,
          total,
          count: tasks.length,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to retrieve tasks", error: error.message });
    }
  },

  assignTruckToTask: async (req, res) => {
    const { taskId } = req.params;
    const { truckName } = req.body;

    try {
      const truck = await Truck.findOne({ name: truckName });
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: { truckId: truck._id } },
        { new: true }
      );

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      truck.tasks.push(updatedTask._id);
      await truck.save();

      res.status(200).json({
        message: "Truck assigned to task successfully",
        task: updatedTask,
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to assign truck", error: error.message });
    }
  },

  traiterTask: async (req, res) => {
    const { taskId } = req.params;
    const { taskStatus } = req.body;

    try {
      if (!["Accepted", "Declined"].includes(taskStatus)) {
        return res.status(400).json({ message: "Invalid task status" });
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: { taskStatus } },
        { new: true }
      );

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.status(200).json({
        message: `Task ${taskStatus} successfully`,
        task: updatedTask,
      });
    } catch (error) {
      res.status(500).json({
        message: "Failed to update task status",
        error: error.message,
      });
    }
  },

  updateTask: async (req, res) => {
    const { taskId } = req.params;

    try {
      const existingTask = await Task.findById(taskId);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      let updateData = { ...req.body };
      if (req.body.deletedMedia && req.body.deletedMedia.length > 0) {
        existingTask.clientObjectPhotos =
          existingTask.clientObjectPhotos.filter(
            (photo) => !req.body.deletedMedia.includes(photo)
          );

        await existingTask.save();
      }

      if (req.files) {
        const newClientObjectPhotos = req.files.map((file) => file.path);

        const updatedClientObjectPhotos = existingTask.clientObjectPhotos
          ? existingTask.clientObjectPhotos.concat(newClientObjectPhotos)
          : newClientObjectPhotos;

        updateData.clientObjectPhotos = updatedClientObjectPhotos;
      }

      const updatedTask = await Task.findByIdAndUpdate(
        taskId,
        { $set: updateData },
        { new: true }
      );

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      res
        .status(200)
        .json({ message: "Task updated successfully", task: updatedTask });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Failed to update task", error: error.message });
    }
  },
};

module.exports = taskCtrl;
