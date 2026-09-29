const mongoose = require('mongoose');
const { User } = require('./User');
const { buildPermissionsSchema } = require('../config/permissionModules');

const adminSchema = new mongoose.Schema({
    permissions: buildPermissionsSchema(),
    gmailTokens: {
        access_token: String,
        refresh_token: String,
        scope: String,
        token_type: String,
        expiry_date: Number,
      },
    gmailHistoryId: {
        type: String,
        default: null,
      },
    gmailEmailAddress: {
        type: String,
        default: null,
      },
    gmailWatchExpiry: {
        type: Number,
        default: null,
      },
    webexTokens: {
        access_token: String,
        refresh_token: String,
        expires_at: Number, // ms epoch
        token_type: String,
        scope: String,
      },
    webexEmail: {
        type: String,
        default: null,
      },
    webexDisplayName: {
        type: String,
        default: null,
      },
    /** My inbox: admin opts in to receive assigned mail (not tied to socket online). */
    inboxAssignmentActive: {
        type: Boolean,
        default: false,
        index: true,
      },
    inboxAssignmentLastActivityAt: {
        type: Date,
        default: null,
      },
    webexTokens: {
        access_token: String,
        refresh_token: String,
        expires_at: Number,
        token_type: String,
        scope: String,
      },
    webexEmail: {
        type: String,
        default: null,
      },
    webexDisplayName: {
        type: String,
        default: null,
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
