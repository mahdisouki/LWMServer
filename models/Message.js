const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  roomId: { type: String, required: true },
  senderId: { type: String, required: true },
  messageText: { type: String },
  image: { type: String },
  fileUrl: { type: String },
  fileType: { type: String },
  audioUrl: { type: String }, // URL du fichier audio pour les messages vocaux
  audioDuration: { type: Number }, // Durée en secondes du message vocal
  messageType: { type: String, enum: ['text', 'image', 'file', 'audio'], default: 'text' }, // Type de message
  seen: { type: Boolean, default: false }, // Whether the message has been seen
  seenAt: { type: Date }, // When the message was seen
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', MessageSchema);