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
  videoUrl: { type: String }, // URL du fichier vidéo pour les messages vidéo
  videoDuration: { type: Number }, // Durée en secondes du message vidéo
  videoThumbnail: { type: String }, // URL de la miniature de la vidéo
  messageType: { type: String, enum: ['text', 'image', 'file', 'audio', 'video'], default: 'text' }, // Type de message
  seen: { type: Boolean, default: false }, // Whether the message has been seen
  seenAt: { type: Date }, // When the message was seen
  seenBy: [{
    userId: { type: String, required: true },
    username: { type: String, required: true },
    picture: { type: String, required: true },
    seenAt: { type: Date, default: Date.now }
  }], // Array of users who have seen this message
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Message', MessageSchema);