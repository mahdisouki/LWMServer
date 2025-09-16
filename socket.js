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
const sendReviewRequestEmail = require('./utils/sendReviewEmail');
let io;
const userSocketMap = {}; // Stores userId:socketId mapping

const admin = require('firebase-admin');
const serviceAccount = require('./waste-app-10e23-firebase-adminsdk-3miif-a9179d3e0a.json');
const Helper = require('./models/Helper');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// const sendNotification = async (title, textMessage, token) => {
//   console.log('Sending notification to:', token);
//   const message = {
//     notification: {
//       title,
//       body: textMessage,
//       // icon: 'https://192.168.62.131:5173/logo.png',
//     },
//     token: token,
//   };

//   admin
//     .messaging()
//     .send(message)
//     .then((response) => {
//       console.log('Successfully sent message:', response);
//     })
//     .catch((error) => {
//       console.error('Error sending message:', error);
//     });
// }

// Initialize the Socket.io server and export the io instance
const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: [
        'https://dirverapp.netlify.app',
        'https://lwmadmin.netlify.app',
        'https://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3001',
        'https://adminlondonwaste.netlify.app',
        'https://driver.londonwastemanagement.uk',
        'https://client.londonwastemanagement.uk',
        'https://admin.londonwastemanagement.uk',
      ],

      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Authorization'],
    },
  });

  // Function to send review request emails
  // const sendReviewRequestEmails = async () => {
  //   console.log("Checking for completed tasks to send review requests");
  //   try {
  //     const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  //     // Find completed tasks from 24 hours ago that haven't received a review request
  //     const completedTasks = await Task.find({
  //       taskStatus: 'Completed',
  //       updatedAt: { $lte: twentyFourHoursAgo },
  //       reviewRequestSent: { $ne: true }
  //     });

  //     console.log(`Found ${completedTasks.length} tasks eligible for review requests`);

  //     for (const task of completedTasks) {
  //       if (task.email) {
  //         try {
  //           // Send review request email
  //           await sendReviewRequestEmail({
  //             email: task.email,
  //             firstName: task.firstName,
  //             orderId: task.orderNumber
  //           });

  //           // Mark the task as having received a review request
  //           await Task.findByIdAndUpdate(task._id, {
  //             reviewRequestSent: true
  //           });

  //           console.log(`Review request email sent for task #${task.orderNumber}`);
  //         } catch (emailError) {
  //           console.error(`Error sending review request email for task #${task.orderNumber}:`, emailError);
  //         }
  //       }
  //     }
  //   } catch (error) {
  //     console.error('Error in sendReviewRequestEmails:', error);
  //   }
  // };

  // // Run the review request check every hour
  // setInterval(sendReviewRequestEmails, 60 * 60 * 1000);

  // Function to check for unpaid online tasks
  const checkUnpaidOnlineTasks = async () => {
    console.log("checking unpaid online tasks")
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Find completed tasks that are online payment method, unpaid, and completed more than 30 minutes ago
      const unpaidTasks = await Task.find({
        paymentMethod: 'online',
        paymentStatus: 'Unpaid',
        taskStatus: 'Completed',
        updatedAt: { $lte: thirtyMinutesAgo }
      });
      console.log(unpaidTasks)
      // Get admin users
      const adminUsers = await User.find({ roleType: 'Admin' });
      console.log(adminUsers)
      // Send notification to each admin
      for (const task of unpaidTasks) {
        const notificationMessage = `Task #${task.orderNumber} has been completed but payment is still pending`;

        for (const admin of adminUsers) {
          await emitNotificationToUser(admin._id, 'Orders', notificationMessage);
        }
      }
    } catch (error) {
      console.error('Error checking unpaid online tasks:', error);
    }
  };

  // Run the check every 5 minutes
  setInterval(checkUnpaidOnlineTasks, 30 * 60 * 1000);

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
    console.log(userSocketMap)
    sendOfflineNotifications(userId, socket);

    // Emit user online status to all connected users
    io.emit('userStatus', { userId, status: 'online' });

    socket.on('joinRoom', async (roomId) => {
      console.log(`User joined room: ${roomId}`);

      // Join the socket room for real-time communication
      socket.join(roomId);

      const messages = await Message.find({ roomId })
        .sort({ createdAt: 1 })
        .select('roomId senderId messageText image fileUrl fileType audioUrl audioDuration messageType seen seenAt seenBy createdAt');
      socket.emit('chatHistory', messages);

      // Notify other users in the room that someone joined
      socket.to(roomId).emit('userJoinedRoom', {
        userId: userId,
        roomId: roomId,
        timestamp: new Date()
      });
    });

    // Admin-specific event to join any room for monitoring
    socket.on('adminJoinRoom', async (roomId) => {
      try {
        // Verify user is admin
        const user = await User.findById(userId);
        if (!user || user.roleType !== 'Admin') {
          socket.emit('error', { message: 'Unauthorized: Admin access required' });
          return;
        }

        console.log(`Admin ${userId} joined room: ${roomId}`);

        // Join the socket room
        socket.join(roomId);
        console.log(`Admin socket ${socket.id} joined room ${roomId}`);

        // Get room messages
        const messages = await Message.find({ roomId })
          .sort({ createdAt: 1 })
          .select('roomId senderId messageText image fileUrl fileType audioUrl audioDuration messageType seen seenAt seenBy createdAt');
        socket.emit('chatHistory', messages);

        // Confirm admin is in the room
        const roomSockets = await io.in(roomId).fetchSockets();
        console.log(`Room ${roomId} now has ${roomSockets.length} sockets:`, roomSockets.map(s => s.id));

        // Get truck information for context
        const truck = await Truck.findById(roomId).populate('driverId helperId', 'username picture');
        if (truck) {
          socket.emit('roomInfo', {
            roomId,
            truck: {
              id: truck._id,
              driver: truck.driverId,
              helper: truck.helperId
            }
          });
        }

        // Notify other users that admin joined
        socket.to(roomId).emit('adminJoinedRoom', {
          adminId: userId,
          adminName: user.username,
          roomId: roomId,
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Error in adminJoinRoom:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Admin event to get all available rooms (trucks)
    socket.on('getAllRooms', async () => {
      try {
        // Verify user is admin
        const user = await User.findById(userId);
        if (!user || user.roleType !== 'Admin') {
          socket.emit('error', { message: 'Unauthorized: Admin access required' });
          return;
        }

        // Get all trucks with their driver and helper info
        const trucks = await Truck.find()
          .populate('driverId', 'username picture')
          .populate('helperId', 'username picture')
          .select('_id driverId helperId');

        const rooms = trucks.map(truck => ({
          roomId: truck._id,
          truck: {
            id: truck._id,
            driver: truck.driverId,
            helper: truck.helperId
          }
        }));

        socket.emit('allRooms', rooms);

      } catch (error) {
        console.error('Error getting all rooms:', error);
        socket.emit('error', { message: 'Failed to get rooms' });
      }
    });

    socket.on('sendMessage', async ({ roomId, senderId, messageText, isDriver, messageType = 'text', isAdmin = false }) => {
      console.log(`Received message in room ${roomId} from user ${senderId}:`, isDriver, 'isAdmin:', isAdmin);
      try {
        const user = await User.findById(senderId);

        let truck;

        if (isAdmin) {
          console.log("is admin");
          truck = await Truck.findById(roomId);
        } else if (isDriver) {
          console.log("is driver");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("is helper");
          truck = await Truck.findById(roomId);
        }



        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
          const message = new Message({
            roomId,
            senderId,
            senderName: user.username,
            messageText,
            image: user.picture,
            messageType: messageType,
          });

          // Save the message to the database
          await message.save();

          console.log(`Message saved in room ${message}`);
          // Emit the new message to the room
          io.to(roomId).emit('newMessage', message);
          return;
        }

        // For admin messages, we don't need to find a related user
        let relatedUser = null;
        if (!isAdmin) {
          const relatedUserId = isDriver ? truck.helperId : truck.driverId;
          relatedUser = await User.findById(relatedUserId);

          if (!relatedUser) {
            console.error(`Related user not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
            return;
          }
        }

        // Create a new message
        const message = new Message({
          roomId,
          senderId,
          messageText,
          image: user.picture,
          messageType: messageType,
        });

        // Save the message to the database
        await message.save();

        console.log(`Message saved in room ${message}`);

        // Debug: Check who's in the room before sending
        const roomSockets = await io.in(roomId).fetchSockets();
        console.log(`Sending message to room ${roomId} with ${roomSockets.length} sockets:`, roomSockets.map(s => s.id));

        // Emit the new message to the room
        io.to(roomId).emit('newMessage', message);
        // Get all socket connections in the room

        // Determine who should receive notifications
        const allUserIds = [
          truck.driverId?.toString(),
          truck.helperId?.toString()
        ];

        // Only add admin to notifications if sender is not admin
        if (!isAdmin) {
          allUserIds.push('67cb6810c9e768ec25d39523'); // Replace with actual admin user ID if known
        }

        for (const receiverId of allUserIds) {
          console.log("receiverId", receiverId)
          if (receiverId && receiverId !== senderId) {
            emitNotificationToUser(receiverId, 'Chat', `New message from ${user.username}`, user.username);
          }
        }
        // sendNotification('New Message Received', `You have a new message from ${user.username}`, relatedUser.fcmToken);

      } catch (error) {
        console.error(`Error processing message in room ${roomId}:`, error);
      }
    });

    // Événement pour les messages vocaux
    socket.on('sendAudioMessage', async ({ roomId, senderId, messageText, isDriver, audioUrl, audioDuration, isAdmin = false }) => {
      console.log(`Received audio message in room ${roomId} from user ${senderId}:`, isDriver, 'isAdmin:', isAdmin);
      try {
        const user = await User.findById(senderId);

        let truck;

        if (isAdmin) {
          console.log("is admin");
          truck = await Truck.findById(roomId);
        } else if (isDriver) {
          console.log("is driver");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("is helper");
          truck = await Truck.findById(roomId);
        }

        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
          const message = new Message({
            roomId,
            senderId,
            messageText,
            image: user.picture,
            audioUrl: audioUrl,
            audioDuration: audioDuration,
            messageType: 'audio',
          });

          await message.save();
          io.to(roomId).emit('newMessage', message);
          return;
        }

        // For admin messages, we don't need to find a related user
        let relatedUser = null;
        if (!isAdmin) {
          const relatedUserId = isDriver ? truck.helperId : truck.driverId;
          relatedUser = await User.findById(relatedUserId);

          if (!relatedUser) {
            console.error(`Related user not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
            return;
          }
        }

        const message = new Message({
          roomId,
          senderId,
          messageText,
          image: user.picture,
          audioUrl: audioUrl,
          audioDuration: audioDuration,
          messageType: 'audio',
        });

        await message.save();
        io.to(roomId).emit('newMessage', message);

        // Envoyer les notifications
        const allUserIds = [
          truck.driverId?.toString(),
          truck.helperId?.toString()
        ];

        // Only add admin to notifications if sender is not admin
        if (!isAdmin) {
          allUserIds.push('67cb6810c9e768ec25d39523');
        }

        for (const receiverId of allUserIds) {
          console.log("receiverId", receiverId)
          if (receiverId && receiverId !== senderId) {
            emitNotificationToUser(receiverId, 'Chat', `New voice message from ${user.username}`, user.username);
          }
        }

      } catch (error) {
        console.error(`Error processing audio message in room ${roomId}:`, error);
      }
    });

    socket.on('sendLocation', async ({ driverId, coordinates, role }) => {
      console.log(`Updating location for driver ${driverId}:`, coordinates);
      console.log(role)
      try {
        console.log(`Updating location for driver ${driverId}:`, coordinates);
        const coordinatesArray = [coordinates.longitude, coordinates.latitude];
        role === "Driver" ? await Driver.findByIdAndUpdate(driverId, {
          location: { type: 'Point', coordinates: coordinatesArray },
        }) : await Helper.findByIdAndUpdate(driverId, {
          location: { type: 'Point', coordinates: coordinatesArray },
        })

        const driver = role == "Driver" ? await Driver.findById(driverId) : await Helper.findById(driverId);

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

    // Get online users
    socket.on('getOnlineUsers', () => {
      const onlineUsers = getOnlineUsers();
      socket.emit('onlineUsersList', onlineUsers);
    });

    // Get messages by roomId with pagination
    socket.on('getMessagesByRoomId', async ({ roomId, skip = 0, limit = 20 }) => {
      try {
        if (!roomId) {
          socket.emit('error', { message: 'Room ID is required' });
          return;
        }

        // Get total count of messages for this room
        const totalMessages = await Message.countDocuments({ roomId });

        const messages = await Message.find({ roomId })
          .sort({ createdAt: -1 }) // Sort by newest first
          .skip(skip) // Skip messages for pagination
          .limit(limit) // Get specified number of messages
          .populate('senderId', 'username picture') // Populate sender info
          .select('roomId senderId messageText image fileUrl fileType audioUrl audioDuration messageType seen seenAt seenBy createdAt'); // Include seenBy information

        // Reverse to get chronological order (oldest to newest)
        const sortedMessages = messages.reverse();

        // Check if there are more messages to load
        const hasMore = skip + limit < totalMessages;

        socket.emit('messagesByRoomId', {
          success: true,
          roomId,
          messages: sortedMessages,
          count: sortedMessages.length,
          totalMessages,
          skip,
          limit,
          hasMore
        });
      } catch (error) {
        console.error('Error getting messages by roomId:', error);
        socket.emit('error', {
          message: 'Failed to get messages by roomId',
          error: error.message
        });
      }
    });
    socket.on('fcmToken', async (fcmToken) => {
      const { userId, token } = fcmToken;
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
            console.log("todayTasks:", todayTasks)
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
    // Typing indicator events
    socket.on('typingStart', async ({ roomId, senderId, isDriver, isAdmin = false }) => {
      try {
        let truck;
        console.log("user is typing:", senderId, "isDriver:", isDriver, "isAdmin:", isAdmin)

        // Get user information
        const user = await User.findById(senderId);
        if (!user) {
          console.error(`User ${senderId} not found`);
          return;
        }

        if (isAdmin) {
          console.log("admin is typing");
          truck = await Truck.findById(roomId);
        } else if (isDriver) {
          console.log("driver is typing");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("helper is typing");
          truck = await Truck.findById(roomId);
        }

        console.log("truck:", truck)
        if (truck) {
          // Emit typing start to the room with user details
          io.to(roomId).emit('userTyping', {
            userId: senderId,
            username: user.username,
            userPicture: user.picture,
            isTyping: true,
            roomId,
            userRole: isAdmin ? 'Admin' : (isDriver ? 'Driver' : 'Helper'),
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error handling typing start:', error);
      }
    });

    socket.on('typingStop', async ({ roomId, senderId, isDriver, isAdmin = false }) => {
      try {
        let truck;

        // Get user information
        const user = await User.findById(senderId);
        if (!user) {
          console.error(`User ${senderId} not found`);
          return;
        }

        if (isAdmin) {
          console.log("admin stopped typing");
          truck = await Truck.findById(roomId);
        } else if (isDriver) {
          console.log("driver stopped typing");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("helper stopped typing");
          truck = await Truck.findById(roomId);
        }

        if (truck) {
          // Emit typing stop to the room with user details
          io.to(roomId).emit('userTyping', {
            userId: senderId,
            username: user.username,
            userPicture: user.picture,
            isTyping: false,
            roomId,
            userRole: isAdmin ? 'Admin' : (isDriver ? 'Driver' : 'Helper'),
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error handling typing stop:', error);
      }
    });

    // Recording indicator events
    socket.on('recordingStart', async ({ roomId, senderId, isDriver, isAdmin = false }) => {
      try {
        let truck;
        console.log("user is recording:", senderId, "isDriver:", isDriver, "isAdmin:", isAdmin)

        // Get user information
        const user = await User.findById(senderId);
        if (!user) {
          console.error(`User ${senderId} not found`);
          return;
        }

        if (isAdmin) {
          console.log("admin is recording");
          truck = await Truck.findById(roomId);
        } else if (isDriver) {
          console.log("driver is recording");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("helper is recording");
          truck = await Truck.findById(roomId);
        }

        console.log("truck:", truck)
        if (truck) {
          // Emit recording start to the room with user details
          io.to(roomId).emit('userRecording', {
            userId: senderId,
            username: user.username,
            userPicture: user.picture,
            isRecording: true,
            roomId,
            userRole: isAdmin ? 'Admin' : (isDriver ? 'Driver' : 'Helper'),
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error handling recording start:', error);
      }
    });

    socket.on('recordingStop', async ({ roomId, senderId, isDriver, isAdmin = false }) => {
      try {
        let truck;

        // Get user information
        const user = await User.findById(senderId);
        if (!user) {
          console.error(`User ${senderId} not found`);
          return;
        }

        if (isAdmin) {
          console.log("admin stopped recording");
          truck = await Truck.findById(roomId);
        } else if (isDriver) {
          console.log("driver stopped recording");
          truck = await Truck.findOne({ driverId: senderId });
        } else {
          console.log("helper stopped recording");
          truck = await Truck.findById(roomId);
        }

        if (truck) {
          // Emit recording stop to the room with user details
          io.to(roomId).emit('userRecording', {
            userId: senderId,
            username: user.username,
            userPicture: user.picture,
            isRecording: false,
            roomId,
            userRole: isAdmin ? 'Admin' : (isDriver ? 'Driver' : 'Helper'),
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('Error handling recording stop:', error);
      }
    });

    // Message seen event
    socket.on('messageSeen', async ({ roomId, messageId, userId }) => {
      try {
        console.log(`Message ${messageId} marked as seen by user ${userId} in room ${roomId}`);

        // Get user information
        const user = await User.findById(userId);
        if (!user) {
          console.error(`User ${userId} not found`);
          return;
        }

        // Check if user has already seen this message
        const message = await Message.findById(messageId);
        if (!message) {
          console.error(`Message ${messageId} not found`);
          return;
        }

        const alreadySeen = message.seenBy.some(seen => seen.userId === userId);
        if (alreadySeen) {
          console.log(`User ${userId} has already seen message ${messageId}`);
          return;
        }

        // Add user to seenBy array
        await Message.findByIdAndUpdate(messageId, {
          $push: {
            seenBy: {
              userId: userId,
              username: user.username,
              picture: user.picture,
              seenAt: new Date()
            }
          },
          seen: true,
          seenAt: new Date()
        });

        // Emit message seen to the room with user details
        io.to(roomId).emit('messageSeenUpdate', {
          messageId,
          seenBy: {
            userId: userId,
            username: user.username,
            picture: user.picture,
            seenAt: new Date()
          }
        });
      } catch (error) {
        console.error('Error handling message seen:', error);
      }
    });

    // Get seen by information for a specific message
    socket.on('getMessageSeenBy', async ({ messageId }) => {
      try {
        const message = await Message.findById(messageId).select('seenBy');
        if (!message) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        socket.emit('messageSeenBy', {
          messageId,
          seenBy: message.seenBy || []
        });
      } catch (error) {
        console.error('Error getting message seen by:', error);
        socket.emit('error', { message: 'Failed to get seen by information' });
      }
    });

    // Mark all messages in room as seen
    socket.on('markAllAsSeen', async ({ roomId, userId }) => {
      try {
        console.log(`User ${userId} marking all messages as seen in room ${roomId}`);

        // Get user information
        const user = await User.findById(userId);
        if (!user) {
          console.error(`User ${userId} not found`);
          return;
        }

        // Find all unread messages in the room for this user
        const unreadMessages = await Message.find({
          roomId,
          senderId: { $ne: userId }, // Not sent by this user
          'seenBy.userId': { $ne: userId } // Not already seen by this user
        });

        let markedCount = 0;

        // Update each message individually to add user to seenBy array
        for (const message of unreadMessages) {
          await Message.findByIdAndUpdate(message._id, {
            $push: {
              seenBy: {
                userId: userId,
                username: user.username,
                picture: user.picture,
                seenAt: new Date()
              }
            },
            seen: true,
            seenAt: new Date()
          });
          markedCount++;
        }

        console.log(`Marked ${markedCount} messages as seen by ${user.username}`);

        // Emit all messages seen to the room with user details
        io.to(roomId).emit('allMessagesSeen', {
          roomId,
          seenBy: {
            userId: userId,
            username: user.username,
            picture: user.picture,
            seenAt: new Date()
          },
          markedCount: markedCount
        });
      } catch (error) {
        console.error('Error marking all messages as seen:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId}`);
      delete userSocketMap[userId]; // Remove user from map on disconnect

      // Emit user offline status to all connected users
      io.emit('userStatus', { userId, status: 'offline' });
    });
  });

  return io;
};

// Function to emit a notification to a specific user by userId
const emitNotificationToUser = async (userId, type, notificationMessage, senderName = null) => {
  const socketId = userSocketMap[userId];
  console.log('entredred to not fun')
  if (socketId && io) {
    io.to(socketId).emit('notification', {
      userId: userId,
      type: type,
      message: notificationMessage,
      senderName: senderName,
      read: false
    });
  } else {
    try {
      // User is offline, save notification to the database
      const newNotification = await Notification.create({
        userId,
        type,
        message: notificationMessage,
        senderName: senderName,
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
  console.log(socket.id)
  console.log(`Sending offline notifications to user: ${userId}`);
  const offlineNotifications = await Notification.find({ userId, read: false });
  console.log(offlineNotifications)
  offlineNotifications?.forEach((notification) => {
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

// Function to get all online users
const getOnlineUsers = () => {
  return Object.keys(userSocketMap);
};

// Function to check if a specific user is online
const isUserOnline = (userId) => {
  return userSocketMap.hasOwnProperty(userId);
};

module.exports = {
  initSocket,
  emitEvent,
  getIo,
  emitNotificationToUser,
  getOnlineUsers,
  isUserOnline,
};
