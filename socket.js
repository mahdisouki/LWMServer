// socket.js
const socketIo = require("socket.io");

let io;

// Initialize the Socket.io server and export the io instance
const initSocket = (server) => {
  io = socketIo(server);

  io.on("connection", (socket) => {
    console.log("A user connected");

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

module.exports = {
  initSocket,
  emitEvent,
};