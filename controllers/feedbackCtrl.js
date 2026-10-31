// controllers/feedbackCtrl.js
const mongoose = require('mongoose');
const Feedback = require('../models/Feedback');
const Task = require('../models/Task');
const APIfeatures = require('../utils/APIFeatures');
const sendReviewRequestEmail = require('../utils/sendReviewEmail');

const feedbackCtrl = {
    createFeedback: async (req, res) => {
        try {
            const { name, description, rate, isVisible, createdByType, orderNumber } = req.body;
            const image = req.file ? req.file.path : null; // Handle image upload via Cloudinary

            // if (!image) {
            //     return res.status(400).json({ message: "Image is required" });
            // }

            if (!rate || rate < 0 || rate > 5) {
                return res.status(400).json({ message: "Rate is required and must be between 0 and 5" });
            }

            const trimmedOrderNumber = typeof orderNumber === 'string' ? orderNumber.trim() : '';

            const newFeedback = new Feedback({
                name,
                description,
                image,
                rate,
                isVisible: isVisible !== undefined ? isVisible : false,
                createdByType: createdByType || 'user',
                ...(trimmedOrderNumber ? { orderNumber: trimmedOrderNumber } : {}),
            });

            await newFeedback.save();
            res.status(201).json({
                message: "Feedback created successfully",
                feedback: newFeedback
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to create feedback",
                error: error.message
            });
        }
    },

    getAllFeedbacks: async (req, res) => {
        try {
            const { page = 1, limit = 9, search, minRate, maxRate } = req.query;

            let filters = { isVisible: true }; // Only show visible feedbacks
            if (req.query.filters) {
                try {
                    const parsedFilters = JSON.parse(req.query.filters);
                    filters = { ...filters, ...parsedFilters };
                    // Ensure isVisible is always true for public endpoint
                    filters.isVisible = true;
                } catch (parseError) {
                    return res.status(400).json({
                        message: "Invalid JSON format in filters",
                        error: parseError.message,
                    });
                }
            }

            // Add search logic
            if (search) {
                filters = {
                    ...filters,
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } },
                    ],
                };
            }

            // Add rate filters
            if (minRate || maxRate) {
                filters.rate = {};
                if (minRate) filters.rate.$gte = parseFloat(minRate);
                if (maxRate) filters.rate.$lte = parseFloat(maxRate);
            }

            const query = Feedback.find(filters).select('-orderNumber');

            const features = new APIfeatures(query, req.query)
                .sorting()
                .paginating();

            const feedbacks = await features.query.exec();
            const total = await Feedback.countDocuments(filters);

            res.status(200).json({
                message: "All feedbacks retrieved successfully",
                feedbacks,
                meta: {
                    currentPage: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total,
                    count: feedbacks.length,
                },
            });

        } catch (error) {
            res.status(500).json({
                message: "Failed to retrieve feedbacks",
                error: error.message
            });
        }
    },

    getFeedbackById: async (req, res) => {
        const { id } = req.params;
        try {
            const feedback = await Feedback.findById(id).select('-orderNumber');
            if (!feedback) {
                return res.status(404).json({ message: "Feedback not found" });
            }
            res.status(200).json({
                message: "Feedback retrieved successfully",
                feedback
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to fetch feedback",
                error: error.message
            });
        }
    },

    updateFeedback: async (req, res) => {
        const { id } = req.params;
        const { name, description, rate, isVisible } = req.body;
        const image = req.file ? req.file.path : undefined;

        // Create a dynamic update object
        const updates = {};
        if (name) updates.name = name;
        if (description) updates.description = description;
        if (rate !== undefined) {
            if (rate < 0 || rate > 5) {
                return res.status(400).json({ message: "Rate must be between 0 and 5" });
            }
            updates.rate = rate;
        }
        if (image) updates.image = image;
        if (isVisible !== undefined) updates.isVisible = isVisible;


        try {
            const updatedFeedback = await Feedback.findByIdAndUpdate(
                id,
                updates,
                { new: true }
            );
            if (!updatedFeedback) {
                return res.status(404).json({ message: "Feedback not found" });
            }
            res.status(200).json({
                message: "Feedback updated successfully",
                feedback: updatedFeedback
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to update feedback",
                error: error.message
            });
        }
    },

    getAllFeedbacksForAdmin: async (req, res) => {
        try {
            const { page = 1, limit = 9, search, keyword, minRate, maxRate } = req.query;

            let filters = {};

            // Admin endpoint: Always return ALL feedbacks (visible and hidden)
            // No isVisible filter = returns everything

            // Add search logic - use keyword or search parameter
            const searchTerm = search || keyword;
            if (searchTerm) {
                filters = {
                    ...filters,
                    $or: [
                        { name: { $regex: searchTerm, $options: 'i' } },
                        { description: { $regex: searchTerm, $options: 'i' } },
                        { orderNumber: { $regex: searchTerm, $options: 'i' } },
                    ],
                };
            }

            // Add rate filters
            if (minRate || maxRate) {
                filters.rate = {};
                if (minRate) filters.rate.$gte = parseFloat(minRate);
                if (maxRate) filters.rate.$lte = parseFloat(maxRate);
            }

            // Note: If you need to handle custom filters from query params,
            // read them directly from req.query (e.g., req.query.status, req.query.category)
            // instead of trying to parse req.query.filters as JSON

            const query = Feedback.find(filters);

            const features = new APIfeatures(query, req.query)
                .sorting()
                .paginating();

            const feedbacks = await features.query.exec();
            const total = await Feedback.countDocuments(filters);

            res.status(200).json({
                message: "All feedbacks retrieved successfully for admin",
                feedbacks,
                meta: {
                    currentPage: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total,
                    count: feedbacks.length,
                },
            });

        } catch (error) {
            res.status(500).json({
                message: "Failed to retrieve feedbacks",
                error: error.message
            });
        }
    },

    deleteFeedback: async (req, res) => {
        const { id } = req.params;
        try {
            const feedback = await Feedback.findByIdAndDelete(id);
            if (!feedback) {
                return res.status(404).json({ message: "Feedback not found" });
            }
            res.status(200).json({ message: "Feedback deleted successfully" });
        } catch (error) {
            res.status(500).json({
                message: "Failed to delete feedback",
                error: error.message
            });
        }
    },

    sendReviewEmail: async (req, res) => {
        try {
            const { taskIds } = req.body;

            // Validate input
            if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
                return res.status(400).json({
                    message: "taskIds array is required and must not be empty"
                });
            }

            // Validate all task IDs are valid MongoDB ObjectIds
            const invalidIds = taskIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
            if (invalidIds.length > 0) {
                return res.status(400).json({
                    message: 'Invalid task IDs provided',
                    invalidIds
                });
            }

            const results = {
                successful: [],
                failed: []
            };
            const processedCustomers = new Set(); // Track customers we've sent to in this batch

            // Process each task ID
            for (const taskId of taskIds) {
                try {
                    // Find the task
                    const task = await Task.findById(taskId);
                    if (!task) {
                        results.failed.push({
                            taskId,
                            reason: "Task not found"
                        });
                        continue;
                    }

                    // Validate required fields
                    if (!task.email || !task.firstName) {
                        results.failed.push({
                            taskId,
                            orderNumber: task.orderNumber,
                            reason: "Task must have email and firstName to send review email"
                        });
                        continue;
                    }

                    // Check if task status is Completed
                    if (task.taskStatus !== 'Completed') {
                        results.failed.push({
                            taskId,
                            orderNumber: task.orderNumber,
                            email: task.email,
                            reason: `Task status must be "Completed" to send review email. Current status: ${task.taskStatus}`
                        });
                        continue;
                    }

                    // Check if email is prevented
                    if (task.preventReviewEmail) {
                        results.failed.push({
                            taskId,
                            orderNumber: task.orderNumber,
                            email: task.email,
                            reason: "Review email is prevented for this task"
                        });
                        continue;
                    }

                    // Check if this customer (by email) has already received a review email from any task
                    // This prevents sending multiple review emails to the same client, even if they have multiple orders
                    const customerHasReceivedReview = await Task.findOne({
                        email: task.email,
                        reviewRequestSent: true
                    });

                    if (customerHasReceivedReview) {
                        // Mark this task as sent to prevent future processing attempts
                        task.reviewRequestSent = true;
                        await task.save();
                        results.failed.push({
                            taskId,
                            orderNumber: task.orderNumber,
                            email: task.email,
                            reason: `Review email has already been sent to this customer (${task.email}). Each client can only receive one review email.`
                        });
                        continue;
                    }

                    // Check if we've already sent to this customer in this batch
                    const emailLower = task.email.toLowerCase();
                    if (processedCustomers.has(emailLower)) {
                        // Mark this task as sent to prevent future processing attempts
                        task.reviewRequestSent = true;
                        await task.save();
                        results.failed.push({
                            taskId,
                            orderNumber: task.orderNumber,
                            email: task.email,
                            reason: `Review email already sent to this customer in this batch`
                        });
                        continue;
                    }

                    // Send the review email
                    await sendReviewRequestEmail({
                        email: task.email,
                        firstName: task.firstName,
                        orderNumber: task.orderNumber
                    });

                    // Mark as sent - one time only!
                    task.reviewRequestSent = true;
                    await task.save();

                    processedCustomers.add(emailLower);

                    results.successful.push({
                        taskId,
                        orderNumber: task.orderNumber,
                        email: task.email,
                        firstName: task.firstName
                    });
                } catch (error) {
                    console.error(`Error processing task ${taskId}:`, error);
                    results.failed.push({
                        taskId,
                        reason: error.message || "Error sending review email"
                    });
                }
            }

            // If only one task ID, return simple response with reason/message
            if (taskIds.length === 1) {
                if (results.successful.length === 1) {
                    return res.status(200).json({
                        message: "Review email sent successfully",
                        task: results.successful[0]
                    });
                } else if (results.failed.length === 1) {
                    return res.status(400).json({
                        message: results.failed[0].reason,
                        taskId: results.failed[0].taskId,
                        orderNumber: results.failed[0].orderNumber,
                        email: results.failed[0].email
                    });
                }
            }

            // Multiple task IDs - return summary structure
            const allSuccessful = results.failed.length === 0;
            res.status(allSuccessful ? 200 : 207).json({
                message: `Processed ${taskIds.length} task(s). ${results.successful.length} successful, ${results.failed.length} failed.`,
                results,
                summary: {
                    total: taskIds.length,
                    successful: results.successful.length,
                    failed: results.failed.length
                }
            });
        } catch (error) {
            console.error('Error sending review emails:', error);
            res.status(500).json({
                message: "Failed to send review emails",
                error: error.message
            });
        }
    }
};

module.exports = feedbackCtrl;
