// routes/upload.js
const express = require('express');
const router = express.Router();
const parser = require('../middlewares/multer');
const Message = require('../models/Message');
const { User } = require('../models/User');
const { getIo, emitNotificationToUser } = require('../socket');
const Truck = require('../models/Truck');

// Route pour les fichiers généraux (images, vidéos, documents)
router.post('/', parser.single('file'), async (req, res) => {
  const { roomId, senderId, messageText, isDriver, isAdmin = false } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const user = await User.findById(senderId);

    // Déterminer le type de message
    let messageType = 'file';
    if (file.mimetype.startsWith('image/')) {
      messageType = 'image';
    } else if (file.mimetype.startsWith('video/')) {
      messageType = 'file';
    }

    const message = new Message({
      roomId,
      senderId,
      messageText,
      image: user.picture,
      fileUrl: file.path,
      fileType: file.mimetype,
      messageType: messageType,
      createdAt: new Date(),
    });

    await message.save();

    const io = getIo();
    io.to(roomId).emit('newMessage', message);

    // Send notifications
    try {
      let truck;
      if (isAdmin) {
        truck = await Truck.findById(roomId);
      } else if (isDriver) {
        truck = await Truck.findOne({ driverId: senderId });
      } else {
        truck = await Truck.findById(roomId);
      }

      if (truck) {
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
          if (receiverId && receiverId !== senderId) {
            const messageTypeText = messageType === 'image' ? 'image' : 'file';
            emitNotificationToUser(receiverId, 'Chat', `New ${messageTypeText} from ${user.username}`, user.username);
          }
        }
      }
    } catch (notificationError) {
      console.error('Error sending notifications for file upload:', notificationError);
    }

    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error('Error saving message with file:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Route spécifique pour les messages vocaux
router.post('/audio', parser.single('audio'), async (req, res) => {
  const { roomId, senderId, messageText, audioDuration, isDriver, isAdmin = false } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  // Vérifier que c'est bien un fichier audio
  if (!file.mimetype.startsWith('audio/')) {
    return res.status(400).json({ error: 'File must be an audio file' });
  }

  try {
    const user = await User.findById(senderId);

    const message = new Message({
      roomId,
      senderId,
      messageText,
      image: user.picture,
      audioUrl: file.path,
      audioDuration: parseFloat(audioDuration) || 0,
      messageType: 'audio',
      createdAt: new Date(),
    });

    await message.save();

    const io = getIo();
    io.to(roomId).emit('newMessage', message);

    // Send notifications
    try {
      let truck;
      if (isAdmin) {
        truck = await Truck.findById(roomId);
      } else if (isDriver) {
        truck = await Truck.findOne({ driverId: senderId });
      } else {
        truck = await Truck.findById(roomId);
      }

      if (truck) {
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
          if (receiverId && receiverId !== senderId) {
            emitNotificationToUser(receiverId, 'Chat', `New voice message from ${user.username}`, user.username);
          }
        }
      }
    } catch (notificationError) {
      console.error('Error sending notifications for audio upload:', notificationError);
    }

    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error('Error saving audio message:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Route spécifique pour les messages vidéo
router.post('/video', parser.single('video'), async (req, res) => {
  const { roomId, senderId, messageText, videoDuration, videoThumbnail, isDriver, isAdmin = false } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  // Vérifier que c'est bien un fichier vidéo
  if (!file.mimetype.startsWith('video/')) {
    return res.status(400).json({ error: 'File must be a video file' });
  }

  try {
    const user = await User.findById(senderId);

    const message = new Message({
      roomId,
      senderId,
      messageText,
      image: user.picture,
      videoUrl: file.path,
      videoDuration: parseFloat(videoDuration) || 0,
      videoThumbnail: videoThumbnail || null,
      messageType: 'video',
      createdAt: new Date(),
    });

    await message.save();

    const io = getIo();
    io.to(roomId).emit('newMessage', message);

    // Send notifications
    try {
      let truck;
      if (isAdmin) {
        truck = await Truck.findById(roomId);
      } else if (isDriver) {
        truck = await Truck.findOne({ driverId: senderId });
      } else {
        truck = await Truck.findById(roomId);
      }

      if (truck) {
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
          if (receiverId && receiverId !== senderId) {
            emitNotificationToUser(receiverId, 'Chat', `New video message from ${user.username}`, user.username);
          }
        }
      }
    } catch (notificationError) {
      console.error('Error sending notifications for video upload:', notificationError);
    }

    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error('Error saving video message:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
