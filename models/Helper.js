
  const mongoose = require('mongoose');
  const { User, userSchema } = require('./User');


  const helperSchema = new mongoose.Schema({
    startTime: { type: Date, required: false },
    endTime: { type: Date, required: false },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: false,
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' }  // Reference to Driver
  });
  
  const Helper = User.discriminator('Helper', helperSchema);
  
  module.exports = Helper;
  

