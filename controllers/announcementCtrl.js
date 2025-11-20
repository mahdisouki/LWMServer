const Announcement = require('../models/announcement');

const announcementCtrl = {
    createAnnouncement: async (req, res) => {
        try {
            const { message } = req.body;

            if (!message) {
                return res.status(400).json({ message: "Message is required" });
            }

            const newAnnouncement = new Announcement({
                message,
            });

            await newAnnouncement.save();
            res.status(201).json({ message: "Announcement created successfully", announcement: newAnnouncement });
        } catch (error) {
            res.status(500).json({ message: "Failed to create announcement", error: error.message });
        }
    },

    getAllAnnouncements: async (req, res) => {
        try {
            const announcements = await Announcement.find().sort({ createdAt: -1 });
            res.status(200).json({
                message: "All announcements retrieved successfully",
                announcements,
                count: announcements.length,
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve announcements", error: error.message });
        }
    },

    getAnnouncementById: async (req, res) => {
        const { id } = req.params;
        try {
            const announcement = await Announcement.findById(id);
            if (!announcement) {
                return res.status(404).json({ message: "Announcement not found" });
            }
            res.status(200).json(announcement);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch announcement", error: error.message });
        }
    },

    updateAnnouncement: async (req, res) => {
        const { id } = req.params;
        const { message } = req.body;

        try {
            if (!message) {
                return res.status(400).json({ message: "Message is required" });
            }

            const updatedAnnouncement = await Announcement.findByIdAndUpdate(
                id,
                { message },
                { new: true, runValidators: true }
            );

            if (!updatedAnnouncement) {
                return res.status(404).json({ message: "Announcement not found" });
            }

            res.status(200).json({ message: "Announcement updated successfully", announcement: updatedAnnouncement });
        } catch (error) {
            res.status(500).json({ message: "Failed to update announcement", error: error.message });
        }
    },

    deleteAnnouncement: async (req, res) => {
        const { id } = req.params;
        try {
            const announcement = await Announcement.findByIdAndDelete(id);
            if (!announcement) {
                return res.status(404).json({ message: "Announcement not found" });
            }
            res.status(200).json({ message: "Announcement deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete announcement", error: error.message });
        }
    },
};

module.exports = announcementCtrl;

