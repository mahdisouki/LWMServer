const express = require('express')
const app = express()
const http = require('http');  

require('dotenv').config();
require('./config/db');
const cors = require('cors');
const Message = require("./models/Message");
const { initSocket, emitEvent } = require("./socket");
const server = http.createServer(app);   
const io = initSocket(server);


const authRouter = require('./routes/auth');
const staffRouter =require('./routes/staff');
const taskRouter =require('./routes/task');
const truckRouter =require('./routes/truck');
const driverRouter =require('./routes/driver');
const messagesRouter = require('./routes/messages');
const { User } = require('./models/User');

const corsOptions = {
  origin: '*', 
  optionsSuccessStatus: 200 
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api',authRouter);
app.use('/api',staffRouter);
app.use('/api',taskRouter);
app.use('/api',truckRouter);
app.use('/api',driverRouter);
app.use('/api',messagesRouter);

// Handle Socket.io connections
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
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

    const user = await User.findById(senderId)
    console.log(user);
    const message = new Message({
      roomId,
      senderId,
      messageText,
      image: user.picture ?? null,
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


// Set up middleware to log each request
app.use((req, res, next) => {
  console.log(`${new Date()} - ${req.method} request for ${req.url}`);
  next();
});

// Start the server
server.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
  console.log(`LondonWaste app listening on port ${process.env.PORT}`);
});
