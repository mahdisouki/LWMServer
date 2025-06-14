const mongoose = require('mongoose');
const { User } = require('./User');

const adminSchema = new mongoose.Schema({
    permissions: {
        Dashboard: { type: [String], enum: ["View", "Edit", "Delete"], default: [] },
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
    },
    emailSignature: {
        type: String,
        default: `
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-family: Arial, sans-serif;">
                <p style="margin: 0; color: #333;">Best regards,</p>
                <p style="margin: 5px 0; font-weight: bold; color: #333;">London Waste Management</p>
                <p style="margin: 5px 0; color: #666;">hello@londonwastemanagement.com</p>
                <p style="margin: 5px 0; color: #666;">02030971517</p>
            </div>
        `
    }
});

const Admin = User.discriminator('Admin', adminSchema);

module.exports = Admin;