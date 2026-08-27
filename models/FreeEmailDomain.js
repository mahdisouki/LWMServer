const mongoose = require('mongoose');
const { Schema } = mongoose;

const freeEmailDomainSchema = new Schema(
  {
    domain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('FreeEmailDomain', freeEmailDomainSchema);
