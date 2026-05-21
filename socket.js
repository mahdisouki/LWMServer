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
const Payroll = require('./models/Payroll');
const sendReviewRequestEmail = require('./utils/sendReviewEmail');
let io;
const userSocketMap = {}; // Stores userId:socketId mapping
const Helper = require('./models/Helper');
const { sendOneSignalNotification } = require('./services/oneSignalService');
const { processDriverLocationUpdate } = require('./services/proximityAutoStartService');
const {
  MESSAGE_SELECT_FIELDS,
  attachReplyTo,
} = require('./utils/chatMessageHelpers');

// Helper function to find truck for a user (including extra drivers/helpers)
async function findTruckForUser(userId) {
  // Primary driver
  let truck = await Truck.findOne({ driverId: userId });
  if (truck) return truck;
  
  // Primary helper
  truck = await Truck.findOne({ helperId: userId });
  if (truck) return truck;
  
  // Extra driver
  truck = await Truck.findOne({ 'extraDrivers.driverId': userId });
  if (truck) return truck;
  
  // Extra helper
  truck = await Truck.findOne({ 'extraHelpers.helperId': userId });
  if (truck) return truck;
  
  return null;
}

// Helper function to get all user IDs for a truck (drivers + helpers, including extra)
async function getAllTruckUserIds(truckId) {
  const truck = await Truck.findById(truckId)
    .populate('driverId')
    .populate('helperId')
    .populate('extraDrivers.driverId')
    .populate('extraHelpers.helperId');
  
  if (!truck) return [];
  
  const userIds = [];
  
  // Primary driver
  if (truck.driverId && truck.driverId._id) {
    userIds.push(truck.driverId._id.toString());
  }
  
  // Primary helper
  if (truck.helperId && truck.helperId._id) {
    userIds.push(truck.helperId._id.toString());
  }
  
  // Extra drivers
  if (truck.extraDrivers && truck.extraDrivers.length > 0) {
    truck.extraDrivers.forEach(extra => {
      if (extra.driverId && extra.driverId._id) {
        userIds.push(extra.driverId._id.toString());
      }
    });
  }
  
  // Extra helpers
  if (truck.extraHelpers && truck.extraHelpers.length > 0) {
    truck.extraHelpers.forEach(extra => {
      if (extra.helperId && extra.helperId._id) {
        userIds.push(extra.helperId._id.toString());
      }
    });
  }
  
  return [...new Set(userIds)]; // Remove duplicates
}

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
        'https://stagingadmin.londonwastemanagement.uk',
        'http://localhost:8081',  // React Native Metro bundler
        'http://192.168.1.15:8081',  // React Native on your network
        'http://10.0.2.2:3000',  // Android emulator
        'http://192.168.1.15:3000',
        'https://192.168.1.15:3000',
      ],


      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],  // Add OPTIONS
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
        .select(MESSAGE_SELECT_FIELDS);
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
          .select(MESSAGE_SELECT_FIELDS);
        socket.emit('chatHistory', messages);

        // Confirm admin is in the room
        const roomSockets = await io.in(roomId).fetchSockets();
        console.log(`Room ${roomId} now has ${roomSockets.length} sockets:`, roomSockets.map(s => s.id));

        // Get truck information for context
        const truck = await Truck.findById(roomId)
          .populate('driverId helperId', 'username picture')
          .populate('extraDrivers.driverId', 'username picture')
          .populate('extraHelpers.helperId', 'username picture');
        if (truck) {
          socket.emit('roomInfo', {
            roomId,
            truck: {
              id: truck._id,
              driver: truck.driverId,
              helper: truck.helperId,
              extraDrivers: truck.extraDrivers,
              extraHelpers: truck.extraHelpers
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
          .populate('extraDrivers.driverId', 'username picture')
          .populate('extraHelpers.helperId', 'username picture')
          .select('_id driverId helperId extraDrivers extraHelpers');

        const rooms = trucks.map(truck => ({
          roomId: truck._id,
          truck: {
            id: truck._id,
            driver: truck.driverId,
            helper: truck.helperId,
            extraDrivers: truck.extraDrivers,
            extraHelpers: truck.extraHelpers
          }
        }));

        socket.emit('allRooms', rooms);

      } catch (error) {
        console.error('Error getting all rooms:', error);
        socket.emit('error', { message: 'Failed to get rooms' });
      }
    });

    socket.on('sendMessage', async ({ roomId, senderId, messageText, isDriver, messageType = 'text', isAdmin = false, fileUrl, fileType, fileUrls, fileTypes, videoUrl, videoDuration, videoThumbnail, videoUrls, videoDurations, videoThumbnails, replyToMessageId }) => {
      console.log(`Received message in room ${roomId} from user ${senderId}:`, isDriver, 'isAdmin:', isAdmin);
      try {
        const user = await User.findById(senderId);

        let truck;

        if (isAdmin) {
          console.log("is admin");
          truck = await Truck.findById(roomId);
        } else {
          truck = await findTruckForUser(senderId); // Use helper function
        }

        // Determine if it's single or multiple files
        const isMultipleFiles = fileUrls && fileUrls.length > 0;
        const isMultipleVideos = videoUrls && videoUrls.length > 0;
        const isSingleFile = fileUrl && !isMultipleFiles;
        const isSingleVideo = videoUrl && !isMultipleVideos;

        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);

          let messageData = {
            roomId,
            senderId,
            senderName: user.username,
            messageText,
            image: user.picture,
            messageType: messageType,
          };

          // Add file data based on what's provided
          if (isSingleFile) {
            messageData.fileUrl = fileUrl;
            messageData.fileType = fileType;
          } else if (isMultipleFiles) {
            messageData.fileUrls = fileUrls;
            messageData.fileTypes = fileTypes;
            messageData.messageType = 'multiple';
          } else if (isSingleVideo) {
            messageData.videoUrl = videoUrl;
            messageData.videoDuration = videoDuration;
            messageData.videoThumbnail = videoThumbnail;
            messageData.messageType = 'video';
          } else if (isMultipleVideos) {
            messageData.videoUrls = videoUrls;
            messageData.videoDurations = videoDurations;
            messageData.videoThumbnails = videoThumbnails;
            messageData.messageType = 'multiple';
          }

          await attachReplyTo(messageData, replyToMessageId, roomId);
          const message = new Message(messageData);
          await message.save();

          console.log(`Message saved in room ${message}`);
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
        let messageData = {
          roomId,
          senderId,
          messageText,
          image: user.picture,
          messageType: messageType,
        };

        // Add file data based on what's provided
        if (isSingleFile) {
          messageData.fileUrl = fileUrl;
          messageData.fileType = fileType;
        } else if (isMultipleFiles) {
          messageData.fileUrls = fileUrls;
          messageData.fileTypes = fileTypes;
          messageData.messageType = 'multiple';
        } else if (isSingleVideo) {
          messageData.videoUrl = videoUrl;
          messageData.videoDuration = videoDuration;
          messageData.videoThumbnail = videoThumbnail;
          messageData.messageType = 'video';
        } else if (isMultipleVideos) {
          messageData.videoUrls = videoUrls;
          messageData.videoDurations = videoDurations;
          messageData.videoThumbnails = videoThumbnails;
          messageData.messageType = 'multiple';
        }

        await attachReplyTo(messageData, replyToMessageId, roomId);
        const message = new Message(messageData);
        await message.save();

        console.log(`Message saved in room ${message}`);

        // Debug: Check who's in the room before sending
        const roomSockets = await io.in(roomId).fetchSockets();
        console.log(`Sending message to room ${roomId} with ${roomSockets.length} sockets:`, roomSockets.map(s => s.id));

        // Emit the new message to the room
        io.to(roomId).emit('newMessage', message);

        // Determine who should receive notifications
        const allUserIds = await getAllTruckUserIds(truck._id);

        // Only add admin to notifications if sender is not admin
        if (!isAdmin) {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          adminUsers.forEach((admin) => {
            const id = admin._id?.toString();
            if (id) allUserIds.push(id);
          });
        }

        for (const receiverId of allUserIds) {
          console.log("receiverId", receiverId)
          if (receiverId && receiverId !== senderId) {
            let notificationText = `New message from ${user.username}`;

            // Customize notification based on message type
            if (isMultipleFiles) {
              notificationText = `New ${fileUrls.length} files from ${user.username}`;
            } else if (isMultipleVideos) {
              notificationText = `New ${videoUrls.length} videos from ${user.username}`;
            } else if (isSingleFile) {
              notificationText = `New file from ${user.username}`;
            } else if (isSingleVideo) {
              notificationText = `New video from ${user.username}`;
            }

            emitNotificationToUser(receiverId, 'Chat', notificationText, user.username);
          }
        }

      } catch (error) {
        console.error(`Error processing message in room ${roomId}:`, error);
      }
    });



    // Event for video messages (handles both single and multiple videos)
    socket.on('sendVideoMessage', async ({ roomId, senderId, messageText, isDriver, videoUrl, videoDuration, videoThumbnail, videoUrls, videoDurations, videoThumbnails, isAdmin = false, replyToMessageId }) => {
      console.log(`Received video message in room ${roomId} from user ${senderId}:`, isDriver, 'isAdmin:', isAdmin);
      try {
        const user = await User.findById(senderId);

        let truck;

        if (isAdmin) {
          console.log("is admin");
          truck = await Truck.findById(roomId);
        } else {
          truck = await findTruckForUser(senderId); // Use helper function
        }

        // Determine if it's single or multiple videos
        const isMultiple = videoUrls && videoUrls.length > 0;
        const isSingle = videoUrl && !isMultiple;

        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);

          let messageData = {
            roomId,
            senderId,
            messageText,
            image: user.picture,
            messageType: isMultiple ? 'multiple' : 'video',
          };

          if (isSingle) {
            messageData.videoUrl = videoUrl;
            messageData.videoDuration = videoDuration;
            messageData.videoThumbnail = videoThumbnail;
          } else if (isMultiple) {
            messageData.videoUrls = videoUrls;
            messageData.videoDurations = videoDurations;
            messageData.videoThumbnails = videoThumbnails;
          }

          await attachReplyTo(messageData, replyToMessageId, roomId);
          const message = new Message(messageData);
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

        let messageData = {
          roomId,
          senderId,
          messageText,
          image: user.picture,
          messageType: isMultiple ? 'multiple' : 'video',
        };

        if (isSingle) {
          messageData.videoUrl = videoUrl;
          messageData.videoDuration = videoDuration;
          messageData.videoThumbnail = videoThumbnail;
        } else if (isMultiple) {
          messageData.videoUrls = videoUrls;
          messageData.videoDurations = videoDurations;
          messageData.videoThumbnails = videoThumbnails;
        }

        await attachReplyTo(messageData, replyToMessageId, roomId);
        const message = new Message(messageData);
        await message.save();
        io.to(roomId).emit('newMessage', message);

        // Send notifications
        const allUserIds = await getAllTruckUserIds(truck._id);

        // Only add admin to notifications if sender is not admin
        if (!isAdmin) {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          adminUsers.forEach((admin) => {
            const id = admin._id?.toString();
            if (id && !allUserIds.includes(id)) allUserIds.push(id);
          });
        }

        for (const receiverId of allUserIds) {
          console.log("receiverId", receiverId)
          if (receiverId && receiverId !== senderId) {
            let notificationText;
            if (isMultiple) {
              notificationText = `New ${videoUrls.length} videos from ${user.username}`;
            } else {
              notificationText = `New video message from ${user.username}`;
            }
            emitNotificationToUser(receiverId, 'Chat', notificationText, user.username);
          }
        }

      } catch (error) {
        console.error(`Error processing video message in room ${roomId}:`, error);
      }
    });

    // Événement pour les messages vocaux
    socket.on('sendAudioMessage', async ({ roomId, senderId, messageText, isDriver, audioUrl, audioDuration, isAdmin = false, replyToMessageId }) => {
      console.log(`Received audio message in room ${roomId} from user ${senderId}:`, isDriver, 'isAdmin:', isAdmin);
      try {
        const user = await User.findById(senderId);

        let truck;

        if (isAdmin) {
          console.log("is admin");
          truck = await Truck.findById(roomId);
        } else {
          truck = await findTruckForUser(senderId); // Use helper function
        }

        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);
          const messageData = {
            roomId,
            senderId,
            messageText,
            image: user.picture,
            audioUrl: audioUrl,
            audioDuration: audioDuration,
            messageType: 'audio',
          };
          await attachReplyTo(messageData, replyToMessageId, roomId);
          const message = new Message(messageData);

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

        const messageData = {
          roomId,
          senderId,
          messageText,
          image: user.picture,
          audioUrl: audioUrl,
          audioDuration: audioDuration,
          messageType: 'audio',
        };
        await attachReplyTo(messageData, replyToMessageId, roomId);
        const message = new Message(messageData);

        await message.save();
        io.to(roomId).emit('newMessage', message);

        // Envoyer les notifications
        const allUserIds = [
          truck.driverId?.toString(),
          truck.helperId?.toString()
        ];

        // Only add admin to notifications if sender is not admin
        if (!isAdmin) {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          adminUsers.forEach((admin) => {
            const id = admin._id?.toString();
            if (id) allUserIds.push(id);
          });
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
    // Event for image/file messages (handles both single and multiple files)
    socket.on('sendImageMessage', async ({ roomId, senderId, messageText, isDriver, imageUrl, imageWidth, imageHeight, fileUrls, fileTypes, isAdmin = false, replyToMessageId }) => {
      console.log(`Received image/file message in room ${roomId} from user ${senderId}:`, isDriver, 'isAdmin:', isAdmin);
      try {
        const user = await User.findById(senderId);

        let truck;

        if (isAdmin) {
          console.log("is admin");
          truck = await Truck.findById(roomId);
        } else {
          truck = await findTruckForUser(senderId); // Use helper function
        }

        // Determine if it's single or multiple files
        const isMultiple = fileUrls && fileUrls.length > 0;
        const isSingle = imageUrl && !isMultiple;

        if (!truck) {
          console.error(`Truck not found for ${isDriver ? 'driver' : 'helper'} ID ${senderId}`);

          let messageData = {
            roomId,
            senderId,
            messageText,
            image: user.picture,
            messageType: isMultiple ? 'multiple' : 'image',
          };

          if (isSingle) {
            messageData.fileUrl = imageUrl;
            messageData.fileType = 'image/jpeg';
          } else if (isMultiple) {
            messageData.fileUrls = fileUrls;
            messageData.fileTypes = fileTypes;
          }

          await attachReplyTo(messageData, replyToMessageId, roomId);
          const message = new Message(messageData);
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

        let messageData = {
          roomId,
          senderId,
          messageText,
          image: user.picture,
          messageType: isMultiple ? 'multiple' : 'image',
        };

        if (isSingle) {
          messageData.fileUrl = imageUrl;
          messageData.fileType = 'image/jpeg';
        } else if (isMultiple) {
          messageData.fileUrls = fileUrls;
          messageData.fileTypes = fileTypes;
        }

        await attachReplyTo(messageData, replyToMessageId, roomId);
        const message = new Message(messageData);
        await message.save();
        io.to(roomId).emit('newMessage', message);

        // Send notifications
        const allUserIds = await getAllTruckUserIds(truck._id);

        // Only add admin to notifications if sender is not admin
        if (!isAdmin) {
          const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
          adminUsers.forEach((admin) => {
            const id = admin._id?.toString();
            if (id && !allUserIds.includes(id)) allUserIds.push(id);
          });
        }

        for (const receiverId of allUserIds) {
          console.log("receiverId", receiverId)
          if (receiverId && receiverId !== senderId) {
            let notificationText;
            if (isMultiple) {
              notificationText = `New ${fileUrls.length} files from ${user.username}`;
            } else {
              notificationText = `New image from ${user.username}`;
            }
            emitNotificationToUser(receiverId, 'Chat', notificationText, user.username);
          }
        }

      } catch (error) {
        console.error(`Error processing image/file message in room ${roomId}:`, error);
      }
    });

    socket.on('sendLocation', async ({ driverId, coordinates, role }) => {
      const actorUserId = socket.user?.userId;
      console.log(`Updating location for user ${actorUserId}:`, coordinates);
      console.log(role)
      try {
        console.log(`Updating location for user ${actorUserId}:`, coordinates);
        if (
          !coordinates ||
          !Number.isFinite(Number(coordinates.latitude)) ||
          !Number.isFinite(Number(coordinates.longitude))
        ) {
          console.error('Invalid coordinates payload received in sendLocation');
          return;
        }

        const coordinatesArray = [coordinates.longitude, coordinates.latitude];
        
        // Find the user first (Driver or Helper)
        const user = await Driver.findById(actorUserId) || await Helper.findById(actorUserId);
        
        if (!user) {
          console.error(`User with ID ${actorUserId} not found.`);
          return;
        }
        
        // Update location directly on the document
        user.location = { type: 'Point', coordinates: coordinatesArray };
        
        // Save the document
        await user.save();

        console.log('location', user.location);
        console.log(user.startTime, 'start time');

        if (user) {
          io.emit('driverLocationUpdate', {
            driverId: actorUserId,
            driverName: user.username,
            coordinates,
            picture: user.picture,
            currentJobAddress: user.currentJobAddress,
            nextJobAddress: user.nextJobAddress,
            onBreak: user.onBreak,
            startTime: user.breakStartTime,
          });
        }

        const isDriver =
          user.roleType === 'Driver' ||
          (Array.isArray(user.role) && user.role.includes('Driver'));

        if (isDriver) {
          const proximityResult = await processDriverLocationUpdate({
            actorUserId: user._id,
            actorUsername: user.username,
            latitude: Number(coordinates.latitude),
            longitude: Number(coordinates.longitude),
          });

          if (proximityResult && !proximityResult.skipped) {
            io.emit('driverHelperProximity', {
              driverId: actorUserId,
              distanceMeters: proximityResult.distanceMeters,
              newlyReachedMilestones: proximityResult.newlyReachedMilestones || [],
              autoStartResult: proximityResult.autoStartResult || null,
            });
            if (proximityResult.autoStartResult?.shiftAutoStarted) {
              io.emit('driverShiftAutoStarted', {
                driverId: String(actorUserId),
                payrollId: proximityResult.autoStartResult.payrollId,
                startTime: proximityResult.autoStartResult.startTime,
                message: 'Your shift has now started',
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error updating location for user ${actorUserId}:`, error);
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

    // Get messages by roomId — supports pagination emit and Socket.IO ack for chat list sorting
    socket.on('getMessagesByRoomId', async (payload, maybeCallback) => {
      const ack = typeof maybeCallback === 'function' ? maybeCallback : null;

      try {
        let roomId;
        let skip = 0;
        let limit = 20;

        if (typeof payload === 'string') {
          roomId = payload;
          if (ack) {
            limit = 1;
          }
        } else if (payload && typeof payload === 'object') {
          roomId = payload.roomId;
          skip = payload.skip ?? 0;
          limit = payload.limit ?? 20;
        }

        const roomIdStr = roomId ? String(roomId) : null;
        if (!roomIdStr) {
          const err = new Error('Room ID is required');
          if (ack) return ack(err);
          socket.emit('error', { message: err.message });
          return;
        }

        const totalMessages = await Message.countDocuments({ roomId: roomIdStr });

        const messages = await Message.find({ roomId: roomIdStr })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('senderId', 'username picture')
          .select(MESSAGE_SELECT_FIELDS)
          .lean();

        if (ack) {
          return ack(null, messages);
        }

        const sortedMessages = [...messages].reverse();
        const hasMore = skip + limit < totalMessages;

        socket.emit('messagesByRoomId', {
          success: true,
          roomId: roomIdStr,
          messages: sortedMessages,
          count: sortedMessages.length,
          totalMessages,
          skip,
          limit,
          hasMore,
        });
      } catch (error) {
        console.error('Error getting messages by roomId:', error);
        if (ack) {
          return ack(error);
        }
        socket.emit('error', {
          message: 'Failed to get messages by roomId',
          error: error.message,
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
        const trucks = await Truck.find();

        let onWorkCount = 0;

        // Collect all driver IDs for batch queries
        const driverIds = trucks.filter(t => t.driverId).map(t => t.driverId);

        // Batch fetch: Get all drivers with their break status
        const drivers = await Driver.find({ _id: { $in: driverIds } })
          .select('_id onBreak');
        const driverMap = new Map();
        drivers.forEach(driver => {
          driverMap.set(driver._id.toString(), driver.onBreak === false);
        });

        // Batch fetch: Get all active payrolls (startTime exists but endTime is null)
        const activePayrolls = await Payroll.find({
          userId: { $in: driverIds },
          startTime: { $exists: true },
          endTime: null
        }).select('userId');
        const activePayrollDriverIds = new Set();
        activePayrolls.forEach(payroll => {
          activePayrollDriverIds.add(payroll.userId.toString());
        });

        // Iterate over trucks to determine if they're on work
        for (const truck of trucks) {
          if (truck.driverId) {
            const driverIdStr = truck.driverId.toString();
            const isNotOnBreak = driverMap.get(driverIdStr);
            // Check if driver is not on break and has an active shift (started but not ended)
            if (isNotOnBreak && activePayrollDriverIds.has(driverIdStr)) {
              onWorkCount += 1;
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

    // Message reactions (one emoji per user per message; tap same emoji to remove)
    socket.on('addReaction', async ({ messageId, roomId, emoji }) => {
      try {
        const actorUserId = socket.user.userId;
        if (!messageId || !roomId || !emoji) {
          socket.emit('error', { message: 'messageId, roomId, and emoji are required' });
          return;
        }

        const user = await User.findById(actorUserId);
        if (!user) {
          socket.emit('error', { message: 'User not found' });
          return;
        }

        const message = await Message.findById(messageId);
        if (!message || message.roomId !== roomId) {
          socket.emit('error', { message: 'Message not found in this room' });
          return;
        }

        if (!message.reactions) {
          message.reactions = [];
        }

        const existingIndex = message.reactions.findIndex((r) => r.userId === actorUserId);

        if (existingIndex >= 0) {
          const existing = message.reactions[existingIndex];
          if (existing.emoji === emoji) {
            message.reactions.splice(existingIndex, 1);
            await message.save();
            io.to(roomId).emit('reactionRemoved', {
              messageId,
              roomId,
              userId: actorUserId,
              reactions: message.reactions,
            });
            io.to(roomId).emit('messageUpdated', {
              messageId,
              roomId,
              reactions: message.reactions,
            });
            return;
          }

          message.reactions[existingIndex].emoji = emoji;
          message.reactions[existingIndex].createdAt = new Date();
          await message.save();
          const reaction = message.reactions[existingIndex];
          io.to(roomId).emit('reactionAdded', {
            messageId,
            roomId,
            reaction,
            reactions: message.reactions,
          });
          io.to(roomId).emit('messageUpdated', {
            messageId,
            roomId,
            reactions: message.reactions,
          });
          return;
        }

        const reaction = {
          userId: actorUserId,
          username: user.username,
          emoji,
          createdAt: new Date(),
        };
        message.reactions.push(reaction);
        await message.save();

        io.to(roomId).emit('reactionAdded', {
          messageId,
          roomId,
          reaction,
          reactions: message.reactions,
        });
        io.to(roomId).emit('messageUpdated', {
          messageId,
          roomId,
          reactions: message.reactions,
        });
      } catch (error) {
        console.error('Error handling addReaction:', error);
        socket.emit('error', { message: 'Failed to add reaction' });
      }
    });

    socket.on('removeReaction', async ({ messageId, roomId }) => {
      try {
        const actorUserId = socket.user.userId;
        if (!messageId || !roomId) {
          socket.emit('error', { message: 'messageId and roomId are required' });
          return;
        }

        const message = await Message.findById(messageId);
        if (!message || message.roomId !== roomId) {
          socket.emit('error', { message: 'Message not found in this room' });
          return;
        }

        const hadReaction = (message.reactions || []).some((r) => r.userId === actorUserId);
        if (!hadReaction) return;

        message.reactions = (message.reactions || []).filter((r) => r.userId !== actorUserId);
        await message.save();

        io.to(roomId).emit('reactionRemoved', {
          messageId,
          roomId,
          userId: actorUserId,
          reactions: message.reactions,
        });
        io.to(roomId).emit('messageUpdated', {
          messageId,
          roomId,
          reactions: message.reactions,
        });
      } catch (error) {
        console.error('Error handling removeReaction:', error);
        socket.emit('error', { message: 'Failed to remove reaction' });
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

    socket.on('oneSignalPlayerId', async (data) => {
      const { userId, playerId } = data;
      
      try {
        // Validate player ID format
        if (!playerId || typeof playerId !== 'string' || playerId.trim().length === 0) {
          console.error(`❌ Invalid OneSignal player ID format for user ${userId}: ${playerId}`);
          return;
        }

        // Check if OneSignal is configured
        if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
          console.warn(`⚠️ OneSignal not configured. Player ID saved but notifications won't work.`);
        }

        const trimmedPlayerId = playerId.trim();
        const user = await User.findById(userId);
        
        if (user) {
          // Add to array if it doesn't exist
          if (!user.oneSignalPlayerIds || !Array.isArray(user.oneSignalPlayerIds)) {
            user.oneSignalPlayerIds = [];
          }
          
          if (!user.oneSignalPlayerIds.includes(trimmedPlayerId)) {
            user.oneSignalPlayerIds.push(trimmedPlayerId);
            // Also update legacy field for backward compatibility
            user.oneSignalPlayerId = trimmedPlayerId;
            await user.save();
            console.log(`✅ OneSignal player ID added for user ${userId}: ${trimmedPlayerId.substring(0, 20)}... (Total: ${user.oneSignalPlayerIds.length})`);
          } else {
            console.log(`ℹ️ OneSignal player ID already registered for user ${userId}`);
          }
        }
        
        console.log(`   OneSignal App ID: ${process.env.ONESIGNAL_APP_ID?.substring(0, 8) || 'NOT SET'}...`);
      } catch (error) {
        console.error(`❌ Error updating OneSignal player ID for user ${userId}:`, error);
      }
    });

    socket.on('oneSignalWebPlayerId', async (data) => {
      const { userId, playerId } = data;
      
      try {
        // Validate player ID format
        if (!playerId || typeof playerId !== 'string' || playerId.trim().length === 0) {
          console.error(`❌ Invalid OneSignal web player ID format for user ${userId}: ${playerId}`);
          return;
        }

        // Check if OneSignal is configured
        if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
          console.warn(`⚠️ OneSignal not configured. Web player ID saved but notifications won't work.`);
        }

        const trimmedPlayerId = playerId.trim();
        const user = await User.findById(userId);
        
        if (user) {
          // Add to array if it doesn't exist
          if (!user.oneSignalWebPlayerIds || !Array.isArray(user.oneSignalWebPlayerIds)) {
            user.oneSignalWebPlayerIds = [];
          }
          
          if (!user.oneSignalWebPlayerIds.includes(trimmedPlayerId)) {
            user.oneSignalWebPlayerIds.push(trimmedPlayerId);
            // Also update legacy field for backward compatibility
            user.oneSignalWebPlayerId = trimmedPlayerId;
            await user.save();
            console.log(`✅ OneSignal web player ID added for user ${userId}: ${trimmedPlayerId.substring(0, 20)}... (Total: ${user.oneSignalWebPlayerIds.length})`);
          } else {
            console.log(`ℹ️ OneSignal web player ID already registered for user ${userId}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error updating OneSignal web player ID for user ${userId}:`, error);
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
const emitNotificationToUser = async (userId, type, notificationMessage, senderName = null, metadata = null) => {
  const socketId = userSocketMap[userId];
  console.log('entered to not fun');
  const payloadMetadata = metadata && typeof metadata === 'object' ? metadata : null;
  const notificationType = payloadMetadata?.type || type;
  
  // Generate title based on type
  const titleMap = {
    'Storage': 'Storage Update',
    'Orders': 'Order Update',
    'Chat': 'New Message',
    'Staff': 'Staff Update',
    'Driver_Tracking': 'Driver Tracking',
    'Payroll': 'Payroll Update',
    'Standard_Items': 'Standard Items Update',
    'Tipping': 'Tipping Update',
    'Truck': 'Truck Update',
    'Day_Off': 'Day Off Request',
    'Busy_Days': 'Busy Days Update',
    'Emails': 'Email Update',
    'Quotations': 'Quotation Update',
    'Payment': 'Payment Update',
    'Payment-failed': 'Payment Failed',
  };
  const title = titleMap[type] || 'Notification';

  // ALWAYS save to database FIRST (before sending via socket/OneSignal)
  let savedNotification = null;
  try {
    savedNotification = await Notification.create({
      userId,
      type,
      message: notificationMessage,
      senderName: senderName,
      metadata: payloadMetadata,
      read: false,
    });
    console.log(`✅ Notification saved to database for user: ${userId}`);
  } catch (dbError) {
    console.error(`❌ Error saving notification to database for user ${userId}:`, dbError);
    // Continue with sending even if DB save fails, but log the error
  }

  if (socketId && io) {
    // User is online - send via socket
    try {
      io.to(socketId).emit('notification', {
        userId: userId,
        type: notificationType,
        category: type,
        title: title,
        message: notificationMessage,
        senderName: senderName,
        ...(payloadMetadata || {}),
        read: false,
        notificationId: savedNotification?._id, // Include DB notification ID
        createdAt: savedNotification?.createdAt || new Date() // Include timestamp for frontend
      });
      console.log(`✅ Socket notification sent to online user: ${userId}`);
    } catch (socketError) {
      console.error(`❌ Error sending socket notification to user ${userId}:`, socketError);
    }
  } else {
    // User is offline - check for web or mobile OneSignal
    try {
      const user = await User.findById(userId).select('oneSignalPlayerId oneSignalPlayerIds oneSignalWebPlayerId oneSignalWebPlayerIds');
      
      // Priority 1: Try web push (for desktop/browser users)
      // Check for array of web player IDs first, then fallback to single ID for backward compatibility
      const webPlayerIds = (user?.oneSignalWebPlayerIds && user.oneSignalWebPlayerIds.length > 0) 
        ? user.oneSignalWebPlayerIds 
        : (user?.oneSignalWebPlayerId ? [user.oneSignalWebPlayerId] : []);
      
      if (user && webPlayerIds.length > 0) {
        const { sendOneSignalWebNotificationToMultiple, sendOneSignalWebNotification } = require('./services/oneSignalService');
        
        // Send to all web player IDs
        const result = await sendOneSignalWebNotificationToMultiple(
          webPlayerIds,
          title,
          notificationMessage,
          {
            type: type,
            notificationType: notificationType,
            userId: userId.toString(),
            senderName: senderName,
            ...(payloadMetadata || {}),
            url: `${process.env.FRONTEND_URL || 'https://www.londonwastemanagement.com'}/notifications?type=${type}`,
          }
        );
        
        if (result && result.invalidPlayerIds && result.invalidPlayerIds.length > 0) {
          console.log(`🗑️ Removing ${result.invalidPlayerIds.length} invalid OneSignal web player ID(s) for user ${userId}`);
          // Remove invalid player IDs from array
          const validPlayerIds = webPlayerIds.filter(id => !result.invalidPlayerIds.includes(id));
          await User.findByIdAndUpdate(userId, {
            oneSignalWebPlayerIds: validPlayerIds,
            oneSignalWebPlayerId: validPlayerIds.length > 0 ? validPlayerIds[0] : null
          });
        } else if (result && result.success) {
          console.log(`✅ OneSignal web push sent to ${webPlayerIds.length} device(s) for offline user: ${userId}`);
        }
      }
      // Priority 2: Try mobile push (for mobile app users)
      // Check for array of mobile player IDs first, then fallback to single ID for backward compatibility
      const mobilePlayerIds = (user?.oneSignalPlayerIds && user.oneSignalPlayerIds.length > 0)
        ? user.oneSignalPlayerIds
        : (user?.oneSignalPlayerId ? [user.oneSignalPlayerId] : []);
      
      if (user && mobilePlayerIds.length > 0) {
        // Send to all mobile player IDs
        const { sendOneSignalNotificationToMultiple } = require('./services/oneSignalService');
        const result = await sendOneSignalNotificationToMultiple(
          mobilePlayerIds,
          title,
          notificationMessage,
          {
            type: type,
            notificationType: notificationType,
            userId: userId.toString(),
            senderName: senderName,
            ...(payloadMetadata || {}),
          }
        );
        
        if (result && result.invalidPlayerIds && result.invalidPlayerIds.length > 0) {
          console.log(`🗑️ Removing ${result.invalidPlayerIds.length} invalid OneSignal player ID(s) for user ${userId}`);
          // Remove invalid player IDs from array
          const validPlayerIds = mobilePlayerIds.filter(id => !result.invalidPlayerIds.includes(id));
          await User.findByIdAndUpdate(userId, {
            oneSignalPlayerIds: validPlayerIds,
            oneSignalPlayerId: validPlayerIds.length > 0 ? validPlayerIds[0] : null
          });
        } else if (result && result.success) {
          console.log(`✅ OneSignal notification sent to ${mobilePlayerIds.length} device(s) for offline user: ${userId}`);
        }
      }

      // Always save to database as backup
      const newNotification = await Notification.create({
        userId,
        type,
        message: notificationMessage,
        senderName: senderName,
        metadata: payloadMetadata,
        read: false,
      });
      console.log(`�� Notification saved to database for user: ${userId}`);
    } catch (error) {
      console.error(`❌ Error sending OneSignal notification to user ${userId}:`, error);
      // Database already saved at the beginning, so we can continue
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

  // Title mapping for offline notifications
  const titleMap = {
    'Storage': 'Storage Update',
    'Orders': 'Order Update',
    'Chat': 'New Message',
    'Staff': 'Staff Update',
    'Driver_Tracking': 'Driver Tracking',
    'Payroll': 'Payroll Update',
    'Standard_Items': 'Standard Items Update',
    'Tipping': 'Tipping Update',
    'Truck': 'Truck Update',
    'Day_Off': 'Day Off Request',
    'Busy_Days': 'Busy Days Update',
    'Emails': 'Email Update',
    'Quotations': 'Quotation Update',
  };

  offlineNotifications?.forEach((notification) => {
    const title = titleMap[notification.type] || 'Notification';
    const metadata = notification.metadata && typeof notification.metadata === 'object'
      ? notification.metadata
      : null;
    const notificationType = metadata?.type || notification.type;
    socket.emit('notification', {
      userId: notification.userId,
      type: notificationType,
      category: notification.type,
      title: title,
      message: notification.message,
      senderName: notification.senderName,
      ...(metadata || {}),
      read: notification.read,
      createdAt: notification.createdAt // Include timestamp for frontend
    });
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

/**
 * Broadcast a refresh signal so clients (mobile + BO) can refetch data.
 * @param {{ resource: string, action?: string, truckId?: string, date?: string, userId?: string, meta?: object }} payload
 */
const emitRefresh = (payload = {}) => {
  if (!io) return;
  io.emit('refresh', {
    ...payload,
    timestamp: new Date().toISOString(),
  });
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

// Function to disconnect a user from all their socket connections
const disconnectUser = (userId) => {
  if (!io) return false;
  
  let disconnected = false;
  const userIdStr = userId.toString();
  
  // Find all sockets for this user
  const sockets = io.sockets.sockets;
  for (const [socketId, socket] of sockets) {
    if (socket.user && socket.user.userId && socket.user.userId.toString() === userIdStr) {
      socket.disconnect(true); // Force disconnect
      disconnected = true;
    }
  }
  
  // Remove from userSocketMap
  if (userSocketMap[userIdStr]) {
    delete userSocketMap[userIdStr];
  }
  
  if (disconnected) {
    console.log(`User ${userId} disconnected from all socket connections`);
  }
  
  return disconnected;
};

module.exports = {
  initSocket,
  emitEvent,
  emitRefresh,
  getIo,
  emitNotificationToUser,
  getOnlineUsers,
  isUserOnline,
  disconnectUser,
};
