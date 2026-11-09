const mongoose = require('mongoose');
const { Schema } = mongoose;

const exitOfferViewSchema = new Schema(
  {
    ip: { type: String, required: true },
    device: { type: String, enum: ['mobile', 'desktop'], required: true },
  },
  { timestamps: true },
);

exitOfferViewSchema.index({ createdAt: 1 });
exitOfferViewSchema.index({ ip: 1, createdAt: 1 });

module.exports = mongoose.model('ExitOfferView', exitOfferViewSchema);
