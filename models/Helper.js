
  const mongoose = require('mongoose');
  const { User, userSchema } = require('./User');


  const helperSchema = new mongoose.Schema({
    startTime: { type: Date, required: false },
    endTime: { type: Date, required: false },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    }
  });

  const Helper = User.discriminator('Helper', helperSchema);

  module.exports = Helper;
