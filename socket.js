// socket.js
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const Message = require('./models/Message');
const Driver = require('./models/Driver');
const Notification = require('./models/Notification');
const { User } = require('./models/User');
const Task = require('./models/Task');
const Truck = require('./models/Truck');
const TippingRequest = require('./models/TippingRequest');
let io;
const userSocketMap = {}; // Stores userId:socketId mapping

const admin = require('firebase-admin');
const serviceAccount = require('./waste-app-10e23-firebase-adminsdk-3miif-a9179d3e0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const sendNotification = async (title, textMessage, token) => {
  console.log('Sending notification to:', token);
  const message = {
    notification: {
      title,
      body: textMessage,
      // icon: 'https://192.168.62.131:5173/logo.png',
    },
    token: token,
  };
  
  admin
    .messaging()
    .send(message)
    .then((response) => {
      console.log('Successfully sent message:', response);
    })
    .catch((error) => {
      console.error('Error sending message:', error);
    });
}
  
// Initialize the Socket.io server and export the io instance
const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: [
        'https://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5173',
        'https://localhost:5174',
        'https://dirverapp.netlify.app', 
        'https://lwmadmin.netlify.app',
        'https://londonwastemanagement.netlify.app'
      ],
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Authorization'],
    },
  });

  // Middleware to authenticate socket connections
  io.use((socket, next) => {
    const token = socket.handshake.headers['authorization']?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication error: Token not provided'));
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return next(new Error('Authentication error: Invalid token'));
      }

      socket.user = decoded;
      console.log(decoded);
      next();
    });
  });

  // Handle connection and events
  io.on('connection', (socket) => {
    const userId = socket.user.userId;
    userSocketMap[userId] = socket.id;
    console.log(`User connected: ${userId} with socket ID ${socket.id}`);
    sendOfflineNotifications(userId, socket);

    socket.on('joinRoom', async (roomId) => {
      socket.join(roomId);
      console.log(`User joined room: ${roomId}`);

      const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
      socket.emit('chatHistory', messages);
    });

    socket.on('sendMessage', async ({ roomId, senderId, messageText, isDriver }) => { 
      console.log(`Received message in room ${roomId} from user ${senderId}:`, isDriver);
      try {
        const user = await User.findById(senderId);
   
        let truck;
        
        if (isDriver) {
          console.log("is driver");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("is helper");
          truck = await Truck.findOne({ helperId: senderId });
        }

        console.log("eeezae", truck);

        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
          const message = new Message({
            roomId,
            senderId,
            messageText,
            image: user.picture,
          });
      
          // Save the message to the database
          await message.save();
          
          console.log(`Message saved in room ${message}`);
          // Emit the new message to the room
          io.to(roomId).emit('newMessage', message);
          return;
        }
    
        const relatedUserId = isDriver ? truck.helperId : truck.driverId;

        const relatedUser = await User.findById(relatedUserId);

        console.log("related user", relatedUser);

        if(!relatedUser) {
          console.error(`Related user not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
          return;
        }

        // Create a new message
        const message = new Message({
          roomId,
          senderId,
          messageText,
          image: user.picture,
        });
    
        // Save the message to the database
        await message.save();
        
        console.log(`Message saved in room ${message}`);
        // Emit the new message to the room
        io.to(roomId).emit('newMessage', message);

        sendNotification('New Message Received', `You have a new message from ${user.username}`, relatedUser.fcmToken);
    
      } catch (error) {
        console.error(`Error processing message in room ${roomId}:`, error);
      }
    });

    socket.on('sendLocation', async ({ driverId, coordinates }) => {
      console.log(`Updating location for driver ${driverId}:`, coordinates);
      try {
        console.log(`Updating location for driver ${driverId}:`, coordinates);
        const coordinatesArray = [coordinates.longitude, coordinates.latitude];
        await Driver.findByIdAndUpdate(driverId, {
          location: { type: 'Point', coordinates: coordinatesArray },
        });
        const driver = await Driver.findById(driverId);
        console.log('location', driver.location);
        console.log(driver.startTime, 'start time');

        if (driver) {
          io.emit('driverLocationUpdate', {
            driverId,
            driverName: driver.username,
            coordinates,
            picture: driver.picture,
            currentJobAddress: driver.currentJobAddress,
            nextJobAddress: driver.nextJobAddress,
            onBreak: driver.onBreak,
            startTime: driver.breakStartTime,
          });
        } else {
          console.error(`Driver with ID ${driverId} not found.`);
        }
      } catch (error) {
        console.error(`Error updating location for driver ${driverId}:`, error);
      }
    });

    socket.on('getLocations', async () => {
      try {
        const drivers = await Driver.find({}).select(
          'location currentJobAddress nextJobAddress picture',
        );
        socket.emit('allDriverLocations', drivers);
      } catch (error) {
        console.error('Error fetching driver locations:', error);
        socket.emit('error', { message: 'Failed to fetch driver locations' });
      }
    });
    socket.on('fcmToken', async (fcmToken) => {
      const { userId , token} = fcmToken;
      try {
        await User.findByIdAndUpdate
          (userId, { fcmToken: token });
      } catch (error) {
        console.error(`Error updating FCM token for user ${userId}:`, error);
      }
    }
    );
    socket.on('trucksStats', async () => {
      try {
        const today = new Date();
        const todayKey = today.toISOString().split('T')[0]; // Format date as "YYYY-MM-DD"
    
        const trucks = await Truck.find().populate({
          path: `tasks.${todayKey}`, // Populate tasks for today's date
          model: 'Task', // Specify the model being referenced
        });
    
        let onWorkCount = 0;
    
        // Iterate over trucks to check tasks for today
        for (const truck of trucks) {
          
          console.log(todayKey)
          if (truck.tasks.has(todayKey)) {
            // Get tasks for today's date
            const todayTasks = truck.tasks.get(todayKey);
            console.log("todayTasks:",todayTasks )
            // Count tasks with "Processing" status
            const processingTasks = todayTasks.filter((task) => task.taskStatus === 'Processing');
            if (processingTasks.length > 0) {
              onWorkCount += 1; // Increment count for trucks with at least one "Processing" task
            }
          }
        }
    
        const allVehiclesCount = await Truck.countDocuments();
        const tippingCount = await TippingRequest.countDocuments({
          status: { $nin: ['Denied', 'Pending'] },
          isShipped: false,
        });
        const onBreakCount = await Driver.countDocuments({ onBreak: true });
    
        // Emit the stats to the client
        io.emit('vehicleStats', {
          allVehicles: allVehiclesCount,
          onWork: onWorkCount,
          tipping: tippingCount,
          onBreak: onBreakCount,
        });
      } catch (error) {
        console.error('Error fetching truck stats:', error);
      }
    });
    socket.on('disconnect', () => {
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
    io.to(socketId).emit('notification', { message: notificationMessage });
  } else {
    try {
      // User is offline, save notification to the database
      const newNotification = await Notification.create({
        userId,
        message: notificationMessage,
        read: false,
      });
      console.log(`Notification saved for offline user: ${userId}`, newNotification);
    } catch (error) {
      console.error(`Error saving notification for user ${userId}:`, error);
    }
  }
};

// Function to send offline notifications to the user upon reconnecting
const sendOfflineNotifications = async (userId, socket) => {
  //emit offline notifications to user
  console.log(`Sending offline notifications to user: ${userId}`);
  const offlineNotifications = await Notification.find({ userId, read: false });
  offlineNotifications.forEach((notification) => {
    socket.emit('notification', { message: notification.message });
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

const getIo = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = {
  initSocket,
  emitEvent,
  getIo,
  emitNotificationToUser,
};
