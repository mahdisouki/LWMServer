const mongoose = require('mongoose');

const instagramTokenSchema = new mongoose.Schema({
  platform: { 
    type: String, 
    required: true, 
    unique: true, 
    default: 'instagram' 
  },
  token: { 
    type: String, 
    required: true 
  },
  expiresAt: { 
    type: Date 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

const InstagramToken = mongoose.model('InstagramToken', instagramTokenSchema);

module.exports = InstagramToken;
