// socket.js
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const Message = require("./models/Message");
const Driver = require("./models/Driver");
const Notification = require("./models/Notification");
const { User } = require("./models/User");
let io;
const userSocketMap = {}; // Stores userId:socketId mapping

// Initialize the Socket.io server and export the io instance
const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: ["http://localhost:5173", "http://localhost:5174"],
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["Authorization"],
    },
  });

  // Middleware to authenticate socket connections
  io.use((socket, next) => {
    const token = socket.handshake.headers['authorization']?.split(" ")[1];

    if (!token) {
      return next(new Error("Authentication error: Token not provided"));
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return next(new Error("Authentication error: Invalid token"));
      }

      socket.user = decoded;
      console.log(decoded)
      next();
    });
  });

  // Handle connection and events
  io.on("connection", (socket) => {
    const userId = socket.user.userId;
    userSocketMap[userId] = socket.id;
    console.log(`User connected: ${userId} with socket ID ${socket.id}`);
    sendOfflineNotifications(userId, socket);

    socket.on("joinRoom", async (roomId) => {
      socket.join(roomId);
      console.log(`User joined room: ${roomId}`);

      const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
      socket.emit("chatHistory", messages);
    });

    socket.on("sendMessage", async ({ roomId, senderId, messageText }) => {
      const user = await User.findById(senderId);
      const message = new Message({ roomId, senderId, messageText, image: user.picture });

      try {
        await message.save();
        io.to(roomId).emit("newMessage", message);
      } catch (error) {
        console.error(`Error saving message in room ${roomId}:`, error);
      }
    });

    socket.on("sendLocation", async ({ driverId, coordinates }) => {
      try {
        await Driver.findByIdAndUpdate(driverId, {
          location: { type: 'Point', coordinates: coordinates },
        });

        const driver = await Driver.findById(driverId).select('picture');
        if (driver) {
          io.emit("driverLocationUpdate", {
            driverId,
            coordinates,
            picture: driver.picture,
            currentJobAddress : driver.currentJobAddress,
            nextJobAddress: driver.nextJobAddress,
            
          });
        } else {
          console.error(`Driver with ID ${driverId} not found.`);
        }
      } catch (error) {
        console.error(`Error updating location for driver ${driverId}:`, error);
      }
    });

    socket.on("getLocations", async () => {
      try {
        const drivers = await Driver.find({}).select('location currentJobAddress nextJobAddress picture');
        socket.emit("allDriverLocations", drivers);
      } catch (error) {
        console.error("Error fetching driver locations:", error);
        socket.emit("error", { message: "Failed to fetch driver locations" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${userId}`);
      delete userSocketMap[userId]; // Remove user from map on disconnect
    });
  });

  return io;
};

// Function to emit a notification to a specific user by userId
const emitNotificationToUser = async (userId, notificationMessage) => {
  const socketId = userSocketMap[userId];

  if (socketId && io) {
    io.to(socketId).emit("notification", { message: notificationMessage });
  } else {
    // User is offline, save notification to the database
    await Notification.create({
      userId,
      message: notificationMessage,
      read: false,
    });
    console.log(`Notification saved for offline user: ${userId}`);
  }
};
// Function to send offline notifications to the user upon reconnecting
const sendOfflineNotifications = async (userId, socket) => {
  const offlineNotifications = await Notification.find({ userId, read: false });
  offlineNotifications.forEach((notification) => {
    socket.emit("notification", { message: notification.message });
  });

  // Mark notifications as read once they are sent to the user
  await Notification.updateMany({ userId, read: false }, { read: true });
};

// Function to emit events globally
const emitEvent = (eventName, data) => {
  if (io) {
    io.emit(eventName, data);
  }
};

module.exports = {
  initSocket,
  emitEvent,
  emitNotificationToUser,
};
