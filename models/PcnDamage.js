const mongoose = require('mongoose');
const { Schema } = mongoose;

const pcnDamageSchema = new Schema({
    // Unique when set; optional PCNs omit this field (sparse index)
    pcnReferenceNumber: { type: String, trim: true, sparse: true, unique: true },
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
    },
    paymentStatus: { type: String, enum: ['Unpaid', 'Paid'], default: 'Unpaid' }, // Payment status
    proofUrl: { type: String },                     // URL to uploaded proof (image/PDF/URL)
    addedBy: { type: String },                      // User name or ID who added this
    time: { type: Date, default: Date.now },        // Time of the PCN/Damage
    vanMatricule: { type: String },                 // Optional van registration / matricule
    linkedToDailySheet: { type: Boolean, default: false }, // Whether PCN is linked to a DailySheet
}, { timestamps: true });

const PcnDamage = mongoose.model('PcnDamage', pcnDamageSchema);
module.exports = PcnDamage;

