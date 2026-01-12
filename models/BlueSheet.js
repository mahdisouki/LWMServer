const mongoose = require('mongoose');
const { Schema } = mongoose;

const blueSheetSchema = new Schema({
  truckId: { type: Schema.Types.ObjectId, ref: 'Truck', required: true },
  date: { type: Date, required: true, index: true },
  
  // Column B: Total In (total of all vans combined)
  totalIn: { type: Number, default: 0 },
  
  // Column C: Commission would charge (fixed £3,760)
  totalCommissionPool: { type: Number, default: 3760 },
  
  // Column D: TEAM 3 route (route total for specific van)
  routeTotal: { type: Number, default: 0 },
  
  // Column E: Percentage commission (routeTotal / totalIn)
  commissionPercentage: { type: Number, default: 0 },
  
  // Column F: Commission Paid day (commissionPercentage * totalCommissionPool)
  commission: { type: Number, default: 0 },
  
  // Column G: Tipping for this day
  tipping: { type: Number, default: 0 },
  
  // Column H: FUEL
  fuel: { type: Number, default: 0 },
  
  // Column I: PCN
  pcnDamage: { type: Number, default: 0 },
  
  // Column J: Other costs (combines: vanHire, insurance, driverOT, labourOT, congestion, stripeCom, paypalComi, etc.)
  otherCosts: { type: Number, default: 0 },
  
  // Column K: PROF
  profit: { type: Number, default: 0 },
  
  // Reference to tasks and tipping requests for this day
  tasks: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
  tippingRequests: [{ type: Schema.Types.ObjectId, ref: 'TippingRequest' }],
  
}, { timestamps: true });

// Index for efficient queries
blueSheetSchema.index({ truckId: 1, date: 1 }, { unique: true });

// Pre-save hook to calculate profit
blueSheetSchema.pre('save', function(next) {
  this.profit = this.routeTotal - (
    this.commission +
    this.tipping +
    this.fuel +
    this.pcnDamage +
    this.otherCosts
  );
  next();
});

const BlueSheet = mongoose.model('BlueSheet', blueSheetSchema);
module.exports = BlueSheet;
