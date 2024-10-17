// socket.js
const socketIo = require("socket.io");

let io;

// Initialize the Socket.io server and export the io instance
const initSocket = (server) => {
  io = socketIo(server , {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);


    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  return io;
};

// Function to emit events so you can use it elsewhere in your project
const emitEvent = (eventName, data) => {
  if (io) {
    io.emit(eventName, data);
  }
};
const emitNotificationToUser = (socketId, notification) => {
  if (io) {
    io.to(socketId).emit("notification", notification);
  }
};

module.exports = {
  initSocket,
  emitEvent,
  emitNotificationToUser
};