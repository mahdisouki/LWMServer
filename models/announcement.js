const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    message: { type: String, required: true },
}, { timestamps: true });

const Announcement = mongoose.model('Announcement', announcementSchema);
module.exports = Announcement;

