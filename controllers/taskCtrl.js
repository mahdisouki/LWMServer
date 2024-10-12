const Task = require("../models/Task");
const Truck = require("../models/Truck");

// class APIfeatures {
//   constructor(query, queryString) {
//     this.query = query;
//     this.queryString = queryString;
//   }
//   filtering() {
//     const queryObj = { ...this.queryString }; //queryString = req.query
//     const exludedFileds = ["page", "sort", "limit"];
//     exludedFileds.forEach((el) => delete queryObj[el]);
//     let queryStr = JSON.stringify(queryObj);
//     queryStr = queryStr.replace(
//       /\b(gte|gt|lt|lte|regex)\b/g,
//       (match) => "$" + match
//     );
//     this.query.find(JSON.parse(queryStr));
//     return this;
//   }
//   sorting() {
//     if (this.queryString.sort) {
//       const sortBy = this.queryString.sort.split(",").join(" ");
//       console.log(sortBy);
//       this.query = this.query.sort(sortBy);
//     } else {
//       this.query = this.query.sort("-createdAt");
//     }
//     return this;
//   }
//   paginating() {
//     const page = this.queryString.page * 1 || 1;
//     const limit = this.queryString.limit * 1 || 9;
//     const skip = (page - 1) * limit;
//     this.query = this.query.skip(skip).limit(limit);
//     return this;
//   }
// }

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
  // GET TASK BY ID
  getTaskById: async (req, res) => {
    const { taskId } = req.params;
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
      const query = Task.find();
      const { page, limit, filters } = req.query;

      const total = await Task.countDocuments(query);

      if (filters) {
        query = query.find(filters);
      }

      let tasks = await query
        .skip((page - 1) * limit)
        .limit(limit)
        .exec();

      // get the truck name by its ID
      tasks = await Promise.all(
        tasks.map(async (task) => {
          console.log(task.truckId);
          if (task.truckId) {
            const truck = await Truck.findById(task.truckId);
            task = task.toObject(); // Converts Mongoose document to a plain object
            task.truckName = truck.name;
          }
          return task;
        })
      );

      res.status(200).json({
        message: "All tasks retrieved successfully",
        tasks,
        meta: {
          currentPage: Number(page),
          limit: Number(limit),
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
