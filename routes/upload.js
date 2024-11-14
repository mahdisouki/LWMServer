// routes/upload.js
const express = require('express');
const router = express.Router();
const parser = require('../middlewares/multer');
const Message = require('../models/Message');
const { User } = require('../models/User');
const { getIo } = require('../socket'); 

router.post('/', parser.single('file'), async (req, res) => {
  const { roomId, senderId, messageText } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const user = await User.findById(senderId);
    
    const message = new Message({
      roomId,
      senderId,
      messageText,
      image: user.picture,
      fileUrl: file.path,
      fileType: file.mimetype,
      createdAt: new Date(),
    });

    await message.save();

    const io = getIo();

    io.to(roomId).emit('newMessage', message);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving message with file:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
