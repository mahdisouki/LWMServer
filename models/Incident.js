const mongoose = require('mongoose');

const { Schema } = mongoose;

// Step subdocument represents one checklist item in the procedure
const stepSchema = new Schema({
    title: { type: String, required: true },
    order: { type: Number, required: true },
    required: { type: Boolean, default: true },
    status: {
        type: String,
        enum: ['PENDING', 'IN_PROGRESS', 'DONE'],
        default: 'PENDING',
    },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
    data: { type: Schema.Types.Mixed }, // step-specific payload (notes, phone, etc.)
});

const photoSchema = new Schema({
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
});

const incidentSchema = new Schema(
    {
        vanId: { type: Schema.Types.ObjectId, ref: 'Van' },
        driverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
        helperId: { type: Schema.Types.ObjectId, ref: 'Helper' },

        // Type of incident: generic incident or breakdown-specific flow
        type: {
            type: String,
            enum: ['accident', 'breakdown'],
            default: 'breakdown',
        },

        incidentTime: { type: Date },
        reportedAt: { type: Date },
        location: { type: String },
        notes: { type: String },
        vanRegistration: { type: String },

        // Accident-specific flat fields
        otherDriverName: { type: String },
        otherDriverContactInfo: { type: String },
        otherDriverEmail: { type: String },
        otherDriverPhone: { type: String },
        otherVehicleRegistration: { type: String },
        isDriverInjured: { type: Boolean },
        canContinueWorking: { type: Boolean },
        isVehicleDrivable: { type: Boolean },
        needsRecoveryService: { type: Boolean },

        // Breakdown-specific flat fields
        breakdownIssueType: {
            type: String,
            enum: [
                'tyre_puncture',
                'tyre_blowout',
                'not_starting',
                'tail_lift',
                'wont_raise',
                'wont_lower',
                'other',
            ],
        },
        canSelfFix: { type: Boolean },
        needsBreakdownAssistance: { type: Boolean },

        vehicleMedia: [photoSchema],
        otherVehicleMedia: [photoSchema],
        otherLicenseMedia: [photoSchema],
        breakdownMedia: [photoSchema],

        status: {
            type: String,
            enum: ['New', 'PENDING_RESOLUTION', 'RESOLVED'],
            default: 'New',
        },

        steps: [stepSchema],
        createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    {
        timestamps: true,
    }
);

// Virtual to compute percentage of required steps completed
incidentSchema.virtual('completion').get(function completionGetter() {
    if (!this.steps || this.steps.length === 0) return 0;
    const requiredSteps = this.steps.filter((s) => s.required);
    if (requiredSteps.length === 0) return 0;
    const completed = requiredSteps.filter((s) => s.status === 'DONE').length;
    return Math.round((completed / requiredSteps.length) * 100);
});

// Helper: can this incident be marked as RESOLVED?
incidentSchema.methods.canResolve = function canResolve() {
    const requiredSteps = (this.steps || []).filter((s) => s.required);
    return requiredSteps.every((s) => s.status === 'DONE');
};

const Incident = mongoose.model('Incident', incidentSchema);

module.exports = Incident;


