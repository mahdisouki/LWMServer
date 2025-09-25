// routes/upload.js
const express = require('express');
const router = express.Router();
const upload = require('../middlewares/multer');
const Message = require('../models/Message');
const { User } = require('../models/User');
const { getIo, emitNotificationToUser } = require('../socket');
const Truck = require('../models/Truck');

// Route pour les fichiers généraux (images, vidéos, documents)
router.post('/', (req, res, next) => {
  upload.array('file', 10)(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => { // Allow up to 10 files
  const { roomId, senderId, messageText, isDriver, isAdmin = false } = req.body;
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const user = await User.findById(senderId);

    // Determine message type based on file types
    let messageType = 'multiple';
    const hasImages = files.some(file => file.mimetype.startsWith('image/'));
    const hasVideos = files.some(file => file.mimetype.startsWith('video/'));

    if (files.length === 1) {
      if (hasImages) {
        messageType = 'image';
      } else if (hasVideos) {
        messageType = 'video';
      } else {
        messageType = 'file';
      }
    }

    // Prepare file data
    const fileUrls = files.map(file => file.path);
    const fileTypes = files.map(file => file.mimetype);

    const message = new Message({
      roomId,
      senderId,
      messageText,
      image: user.picture,
      // For backward compatibility, set single file fields if only one file
      fileUrl: files.length === 1 ? files[0].path : null,
      fileType: files.length === 1 ? files[0].mimetype : null,
      // New array fields for multiple files
      fileUrls: fileUrls,
      fileTypes: fileTypes,
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
            let messageTypeText = 'file';
            if (messageType === 'image') {
              messageTypeText = 'image';
            } else if (messageType === 'video') {
              messageTypeText = 'video';
            } else if (messageType === 'multiple') {
              messageTypeText = `${files.length} files`;
            }
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

// Route spécifique pour les messages vidéo
router.post('/video', (req, res, next) => {
  upload.array('video', 10)(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const { roomId, senderId, messageText, videoDuration, videoThumbnail, isDriver, isAdmin = false } = req.body;
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No video files uploaded' });
  }

  // Vérifier que ce sont bien des fichiers vidéo
  const invalidFiles = files.filter(file => !file.mimetype.startsWith('video/'));
  if (invalidFiles.length > 0) {
    return res.status(400).json({ error: 'All files must be video files' });
  }

  try {
    const user = await User.findById(senderId);

    // Parse durations and thumbnails (assuming they come as comma-separated strings)
    const durations = videoDuration ? videoDuration.split(',').map(d => parseFloat(d.trim())) : [];
    const thumbnails = videoThumbnail ? videoThumbnail.split(',').map(t => t.trim()) : [];

    // Prepare video data
    const videoUrls = files.map(file => file.path);
    const videoDurations = files.map((file, index) => durations[index] || 0);
    const videoThumbnails = files.map((file, index) => thumbnails[index] || null);

    const message = new Message({
      roomId,
      senderId,
      messageText: messageText || '',
      image: user.picture,
      // For backward compatibility, set single video fields if only one video
      videoUrl: files.length === 1 ? files[0].path : undefined,
      videoDuration: files.length === 1 ? videoDurations[0] : undefined,
      videoThumbnail: files.length === 1 ? videoThumbnails[0] : undefined,
      // New array fields for multiple videos
      videoUrls: videoUrls,
      videoDurations: videoDurations,
      videoThumbnails: videoThumbnails,
      // Also set fileUrls and fileTypes for consistency with frontend
      fileUrls: videoUrls,
      fileTypes: files.map(file => file.mimetype),
      messageType: files.length === 1 ? 'video' : 'multiple',
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
            const messageTypeText = files.length === 1 ? 'video' : `${files.length} videos`;
            emitNotificationToUser(receiverId, 'Chat', `New ${messageTypeText} from ${user.username}`, user.username);
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

// Route spécifique pour les messages vocaux
router.post('/audio', upload.single('audio'), async (req, res) => {
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



module.exports = router;
