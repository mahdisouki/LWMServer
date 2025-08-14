// routes/upload.js
const express = require('express');
const router = express.Router();
const parser = require('../middlewares/multer');
const Message = require('../models/Message');
const { User } = require('../models/User');
const { getIo } = require('../socket');

// Route pour les fichiers généraux (images, vidéos, documents)
router.post('/', parser.single('file'), async (req, res) => {
  const { roomId, senderId, messageText } = req.body;
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

    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error('Error saving message with file:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Route spécifique pour les messages vocaux
router.post('/audio', parser.single('audio'), async (req, res) => {
  const { roomId, senderId, messageText, audioDuration } = req.body;
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

    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error('Error saving audio message:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
