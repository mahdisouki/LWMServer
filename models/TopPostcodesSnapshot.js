const mongoose = require('mongoose');
const { Schema } = mongoose;

const topPostcodeRowSchema = new Schema(
  {
    rank: { type: Number, required: true },
    postcode: { type: String, required: true },
    orders: { type: Number, required: true, default: 0 },
    quotes: { type: Number, required: true, default: 0 },
    sharePercent: { type: Number, required: true, default: 0 },
    color: { type: String, required: true },
  },
  { _id: false },
);

const topPostcodesSnapshotSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    postcodes: {
      type: [topPostcodeRowSchema],
      default: [],
    },
    totals: {
      orders: { type: Number, default: 0 },
      quotes: { type: Number, default: 0 },
    },
    orderAttribution: {
      type: Schema.Types.Mixed,
      default: {},
    },
    quoteAttribution: {
      type: Schema.Types.Mixed,
      default: {},
    },
    grouping: {
      type: Schema.Types.Mixed,
      default: {},
    },
    limit: {
      type: Number,
      default: 50,
    },
    computedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

const TopPostcodesSnapshot = mongoose.model(
  'TopPostcodesSnapshot',
  topPostcodesSnapshotSchema,
);

module.exports = TopPostcodesSnapshot;
module.exports.SNAPSHOT_KEY = 'default';
