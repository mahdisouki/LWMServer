
const mongoose = require('mongoose');
const { User } = require('./User');

const adminSchema = new mongoose.Schema({
    permissions: {
        Staff: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Orders: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Driver_Tracking: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Payroll: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Chat: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Standard_Items: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Tipping: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Storage: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Truck: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Day_Off: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Busy_Days: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Emails: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
        Quotations: { type: [String], enum: ["View", "Edit", "Delete"], default: [] }
    }
});
const Admin = User.discriminator('Admin', adminSchema);

module.exports = Admin;