const express = require("express");
const app = express();
const http = require("http");

require("dotenv").config();
require("./config/db");
const cors = require("cors");
const Message = require("./models/Message");
const { initSocket, emitEvent } = require("./socket");
const server = http.createServer(app);
const io = initSocket(server);

const authRouter = require("./routes/auth");
const staffRouter = require("./routes/staff");
const taskRouter = require("./routes/task");
const truckRouter = require("./routes/truck");
const driverRouter = require("./routes/driver");
const tippingRouter = require("./routes/tipping");
const dayoffRouter = require("./routes/dayoff");

app.use(cors());
app.use(express.json());
app.use("/api", authRouter);
app.use("/api", staffRouter);
app.use("/api", taskRouter);
app.use("/api", truckRouter);
app.use("/api", driverRouter);
app.use("/api", tippingRouter);
app.use("/api", dayoffRouter);

// Handle Socket.io connections
io.on("connection", (socket) => {
  console.log("A user connected");
  // Handle joining a room (conversation between admin and a specific staff member)
  socket.on("joinRoom", async (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);

    // Optionally, fetch chat history from the database when joining a room
    const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
    socket.emit("chatHistory", messages);
  });

  // Handle sending a message
  socket.on("sendMessage", async ({ roomId, senderId, messageText }) => {
    const message = new Message({
      roomId,
      senderId,
      messageText,
    });

    // Save the message to the database
    await message.save();

    // Broadcast the message to all users in the room
    io.to(roomId).emit("newMessage", message);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});
