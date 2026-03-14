const mongoose = require('mongoose');
const { Schema } = mongoose;

const pcnDamageSchema = new Schema({
    pcnReferenceNumber: { type: String }, // PCN reference number from request body
    dailySheetId: {
        type: Schema.Types.ObjectId,
        ref: 'DailySheet',
        required: false
    }, // Optional - PCN can exist without a daily sheet
    reason: { type: String, required: true },       // Reason for PCN/Damage
    amount: { type: Number, required: false },       // Amount to deduct
    deductedFromUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },                                              // User ID (Driver or Helper) to deduct from
    proofUrl: { type: String },                     // URL to uploaded proof (image/PDF/URL)
    addedBy: { type: String },                      // User name or ID who added this
    time: { type: Date, default: Date.now },        // Time of the PCN/Damage
    vanMatricule: { type: String },                 // Optional van registration / matricule
}, { timestamps: true });

const PcnDamage = mongoose.model('PcnDamage', pcnDamageSchema);
module.exports = PcnDamage;

