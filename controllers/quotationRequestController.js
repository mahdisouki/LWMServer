const QuotationRequest = require('../models/QuotationRequest');
const Task = require('../models/Task');
const sendQuotationEmail = require('../utils/sendQuotationEmail'); // Utility function to send email notifications
const APIfeatures = require('../utils/APIFeatures');
const FormData = require('form-data')
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const axios = require('axios');
const { emitNotificationToUser } = require('../socket');
const { sendQuoteRequestConfirmationEmail } = require('../services/emailsService');
const { User } = require('../models/User');
const quotationRequestController = {
    createQuotationRequest: async (req, res) => {
        try {
            const {
                firstName,
                lastName,
                address,
                email,
                phoneNumber,
                postcode,
                comments,
            } = req.body;
            console.log("req.body", req.body)

            // Handle optional file uploads
            const items = req.files ? req.files.map((file) => file.path) : [];
            const predictions = [];
            let estimatedPrices = [];

            // Process files through AI prediction only if files are uploaded
            if (req.files && req.files.length > 0) {
                // Download the image from Cloudinary and send it to the Flask API
                // Skip AI prediction for video files as they are too large for the API
                for (const file of req.files) {
                    // Skip video and audio files - AI prediction API only supports images
                    if (file.mimetype && (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/'))) {
                        console.log(`Skipping AI prediction for ${file.mimetype} file: ${file.originalname}`);
                        continue;
                    }

                    try {
                        const response = await fetch(file.path); // Download the file from Cloudinary
                        const arrayBuffer = await response.arrayBuffer(); // Convert to ArrayBuffer
                        const buffer = Buffer.from(arrayBuffer); // Convert to Buffer for formData

                        const formData = new FormData();
                        formData.append('file', buffer, {
                            filename: file.originalname,
                            contentType: file.mimetype,
                        });

                        const aiResponse = await axios.post('http://147.93.85.229/predict', formData, {
                            headers: {
                                ...formData.getHeaders(),
                            },
                            maxBodyLength: Infinity,
                            maxContentLength: Infinity,
                        });

                        if (aiResponse.data && aiResponse.data.predictions) {
                            predictions.push(...aiResponse.data.predictions);
                        }
                    } catch (error) {
                        // Handle 413 errors and other API errors gracefully
                        if (error.response && error.response.status === 413) {
                            console.warn(`File ${file.originalname} is too large for AI prediction API. Skipping...`);
                            // Continue processing other files
                            continue;
                        } else {
                            console.error(`Error processing file ${file.originalname} for AI prediction:`, error.message);
                            // Continue processing other files even if one fails
                            continue;
                        }
                    }
                }

                // Transform AI predictions into estimatedPrices format
                estimatedPrices = predictions.map(pred => ({
                    name: pred.classe,
                    price: pred.price_inc_vat.toString(),
                }));
            }

            const newQuotation = new QuotationRequest({
                Name: `${firstName} ${lastName}`,
                address,
                email,
                phoneNumber,
                postcode,
                comments,
                items,
                estimatedPrices,
            });

            // Send confirmation email to user
            sendQuoteRequestConfirmationEmail(email, newQuotation);

            // Save quotation to database
            await newQuotation.save();

            // Send email to responsible person (similar to contact request / moving service)
            const quotationData = {
                firstName,
                lastName,
                line1: address,
                line2: '',
                postcode,
                email,
                phoneNumber,
                comments,


                items,
            };

            const responsibleEmail = 'hello@londonwastemanagement.com';
            await sendQuotationEmail({ responsibleEmail, quotationData });

            // Send notification to all admins
            try {
                const adminUsers = await User.find({ roleType: 'Admin' }).select('_id');
                const customerName = firstName && lastName
                    ? `${firstName} ${lastName}`
                    : 'Customer';
                const notificationMessage = `A new quotation request has been submitted by ${customerName}`;

                // Send notification to all admins
                for (const admin of adminUsers) {
                    if (admin._id) {
                        await emitNotificationToUser(
                            admin._id.toString(),
                            'Quotations',
                            notificationMessage,
                            customerName
                        );
                    }
                }
            } catch (notificationError) {
                console.error('Error sending notification to admin:', notificationError);
                // Don't fail the request if notification fails
            }

            res.status(201).json({
                message: 'Quotation request submitted successfully',
                quotation: newQuotation,
            });

        } catch (error) {
            console.error('Error creating quotation request:', error);
            res.status(500).json({
                message: 'Failed to submit quotation request',
                error: error.message,
            });
        }
    },



    getAllQuotations: async (req, res) => {
        try {
            const {
                page = 1,
                limit = 10,
                keyword,
                startDate,
                endDate,
                status,
                statusDateStart,
                statusDateEnd,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            // Build the query
            let query = {};

            // Add search condition if keyword exists
            if (keyword) {
                query = {
                    $or: [
                        { Name: { $regex: keyword, $options: 'i' } },
                        { email: { $regex: keyword, $options: 'i' } },
                        { phoneNumber: { $regex: keyword, $options: 'i' } },
                        { postcode: { $regex: keyword, $options: 'i' } },
                        { address: { $regex: keyword, $options: 'i' } }
                    ]
                };
            }

            // Add date range if provided (for quotation creation date)
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) {
                    query.createdAt.$gte = new Date(startDate);
                }
                if (endDate) {
                    query.createdAt.$lte = new Date(endDate);
                }
            }

            // Build sort object
            const sort = {};
            sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

            // Check if status or statusDate filtering is needed
            const needsStatusFiltering = status || statusDateStart || statusDateEnd;

            let quotations;
            let total;

            if (needsStatusFiltering) {
                // Fetch all quotations matching the base query (no pagination yet)
                quotations = await QuotationRequest.find(query).sort(sort);
            } else {
                // Calculate total count BEFORE pagination
                total = await QuotationRequest.countDocuments(query);

                // Apply pagination at database level for better performance
                const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
                quotations = await QuotationRequest
                    .find(query)
                    .sort(sort)
                    .skip(skip)
                    .limit(parseInt(limit, 10));
            }

            // Get all quotation IDs to check for associated orders
            const quotationIds = quotations.map(q => q._id);

            // Find all tasks that have these quotationIds with createdAt dates
            const tasksWithQuotations = await Task.find({
                quotationId: { $in: quotationIds },
                paymentStatus: { $ne: 'Failed' },
            }).select('quotationId createdAt');

            // Create a Map of quotationId -> Task createdAt for quick lookup
            const quotationsWithOrders = new Map();
            tasksWithQuotations.forEach(task => {
                if (task.quotationId) {
                    const quotationIdStr = task.quotationId.toString();
                    if (!quotationsWithOrders.has(quotationIdStr) ||
                        task.createdAt < quotationsWithOrders.get(quotationIdStr)) {
                        quotationsWithOrders.set(quotationIdStr, task.createdAt);
                    }
                }
            });

            // Add status and statusDate fields to each quotation using model method
            let quotationsWithStatus = quotations.map(quotation => {
                const quotationObj = quotation.toObject();
                const quotationIdStr = quotation._id.toString();
                const taskCreatedAt = quotationsWithOrders.get(quotationIdStr) || null;

                const statusInfo = quotation.getStatusSync(taskCreatedAt);
                quotationObj.status = statusInfo.status;
                quotationObj.statusDate = statusInfo.statusDate;
                quotationObj.hasOrder = statusInfo.hasOrder;

                return quotationObj;
            });

            // Filter by status if provided
            if (status) {
                quotationsWithStatus = quotationsWithStatus.filter(q => q.status === status);
            }

            // Filter by status date range if provided
            if (statusDateStart || statusDateEnd) {
                quotationsWithStatus = quotationsWithStatus.filter(q => {
                    if (!q.statusDate) return false;
                    const statusDate = new Date(q.statusDate);
                    if (statusDateStart && statusDate < new Date(statusDateStart)) return false;
                    if (statusDateEnd && statusDate > new Date(statusDateEnd)) return false;
                    return true;
                });
            }

            // Calculate total count AFTER status filtering (if status filtering was applied)
            if (needsStatusFiltering) {
                total = quotationsWithStatus.length;

                // Apply pagination AFTER status filtering
                const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
                quotationsWithStatus = quotationsWithStatus.slice(skip, skip + parseInt(limit, 10));
            }

            // Calculate the number of pages (count)
            const pageCount = Math.ceil(total / parseInt(limit, 10));

            res.status(200).json({
                message: "All quotations retrieved successfully",
                quotations: quotationsWithStatus,
                meta: {
                    currentPage: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total: total,
                    count: pageCount, // Fixed: Calculate total pages, not items on current page
                },
            });
        } catch (error) {
            res.status(500).json({
                message: "Failed to retrieve quotations",
                error: error.message,
            });
        }
    },


    getQuotationById: async (req, res) => {
        const { id } = req.params;
        try {
            const quotation = await QuotationRequest.findById(id);
            if (!quotation) {
                return res
                    .status(404)
                    .json({ message: 'Quotation not found' });
            }

            // Mark as read when viewed
            if (!quotation.read) {
                quotation.read = true;
                await quotation.save();
            }

            // Use the model's instance method to compute status
            const statusInfo = await quotation.computeStatus();
            const quotationObj = quotation.toObject();
            quotationObj.status = statusInfo.status;
            quotationObj.statusDate = statusInfo.statusDate;
            quotationObj.hasOrder = statusInfo.hasOrder;

            res.status(200).json(quotationObj);
        } catch (error) {
            res.status(500).json({
                message: 'Failed to retrieve quotation',
                error: error.message,
            });
        }
    },
    // getAllQuotations: async (req, res) => {
    //     try {
    //         const quotations = await QuotationRequest.find();
    //         res.status(200).json(quotations);
    //     } catch (error) {
    //         res.status(500).json({ message: "Failed to retrieve quotations", error: error.message });
    //     }
    // },

    sendQuotationFormEmail: async (req, res) => {
        try {
            const {
                firstName,
                lastName,
                address,
                email,
                phoneNumber,
                postcode,
                comments,
            } = req.body;

            // Use the single address field for email template
            const line1 = address;
            const line2 = '';

            // Compose the quotationData object as expected by sendQuotationEmail
            const quotationData = {
                line1,
                line2,
                postcode,
                email,
                phoneNumber,
                companyName: '', // Not in form, so leave blank or add if available
                comments,
                items: req.files ? req.files.map((file) => file.path) : [],
            };

            // Use a responsible email from env or hardcoded for now
            const responsibleEmail = process.env.QUOTATION_RESPONSIBLE_EMAIL || 'admin@londonwastemanagement.com';

            await sendQuotationEmail({ responsibleEmail, quotationData });

            res.status(200).json({ message: 'Quotation email sent successfully.' });
        } catch (error) {
            console.error('Error sending quotation email:', error);
            res.status(500).json({ message: 'Failed to send quotation email', error: error.message });
        }
    },

    sendMovingServiceEmail: async (req, res) => {
        try {
            const {
                fullName,
                contactNumber,
                email,
                pickUpLocation,
                dropOffLocation,
                pickUpPropertyType,
                dropOffPropertyType,
                packingRequired,
                accessInfo,
                extraInfo,
            } = req.body;
            console.log("req.body", req.body)
            const files = req.files ? req.files.map((file) => file.path) : [];

            const contactData = {
                fullName,
                contactNumber,
                email,
                pickUpLocation,
                dropOffLocation,
                pickUpPropertyType,
                dropOffPropertyType,
                packingRequired,
                accessInfo,
                extraInfo,
                files,
            };

            const responsibleEmail = process.env.RESPONSIBLE_EMAIL;
            const sendContactEmail = require('../utils/sendContactEmail');
            await sendContactEmail({ responsibleEmail, contactData });

            res.status(200).json({ message: 'Moving service email sent successfully.' });
        } catch (error) {
            console.error('Error sending moving service email:', error);
            res.status(500).json({ message: 'Failed to send moving service email', error: error.message });
        }
    },

    sendBusinessQuoteEmail: async (req, res) => {
        try {
            const {
                businessName,
                industryType,
                wasteType,
                estimatedVolume,
                collectionFrequency,
                monthlySpend,
                contactName,
                email,
                phoneNumber,
                additionalDetails,
            } = req.body;

            // Handle file uploads - get file paths from multer
            const photos = req.files ? req.files.map((file) => file.path) : [];

            const contactData = {
                businessName,
                industryType,
                wasteType,
                estimatedVolume,
                collectionFrequency,
                monthlySpend,
                contactName,
                email,
                phoneNumber,
                additionalDetails,
                photos,
            };

            const responsibleEmail = process.env.RESPONSIBLE_EMAIL;
            const sendBusinessQuoteEmail = require('../utils/sendBusinessQuoteEmail');
            await sendBusinessQuoteEmail({ responsibleEmail, contactData });

            res.status(200).json({ message: 'Business quote email sent successfully.' });
        } catch (error) {
            console.error('Error sending business quote email:', error);
            res.status(500).json({ message: 'Failed to send business quote email', error: error.message });
        }
    },

    sendRecruitmentEmail: async (req, res) => {
        try {
            const {
                fullName,
                email,
                phoneNumber,
                roleOfInterest,
                experienceLevel,
                message,
            } = req.body;

            const cvFile = req.file ? req.file.path : null;

            const contactData = {
                fullName,
                email,
                phoneNumber,
                roleOfInterest,
                experienceLevel,
                message,
                cvFile,
            };

            const responsibleEmail = process.env.RESPONSIBLE_EMAIL;
            const sendRecruitmentEmail = require('../utils/sendRecruitmentEmail');
            await sendRecruitmentEmail({ responsibleEmail, contactData });

            res.status(200).json({ message: 'Recruitment application email sent successfully.' });
        } catch (error) {
            console.error('Error sending recruitment email:', error);
            res.status(500).json({ message: 'Failed to send recruitment email', error: error.message });
        }
    },

    markQuotationAsRead: async (req, res) => {
        const { id } = req.params;
        try {
            const quotation = await QuotationRequest.findByIdAndUpdate(
                id,
                { read: true },
                { new: true }
            );

            if (!quotation) {
                return res.status(404).json({ message: 'Quotation not found' });
            }

            res.status(200).json({
                message: 'Quotation marked as read',
                quotation
            });
        } catch (error) {
            res.status(500).json({
                message: 'Failed to mark quotation as read',
                error: error.message,
            });
        }
    },

    markQuotationAsUnread: async (req, res) => {
        const { id } = req.params;
        try {
            const quotation = await QuotationRequest.findByIdAndUpdate(
                id,
                { read: false },
                { new: true }
            );

            if (!quotation) {
                return res.status(404).json({ message: 'Quotation not found' });
            }

            res.status(200).json({
                message: 'Quotation marked as unread',
                quotation
            });
        } catch (error) {
            res.status(500).json({
                message: 'Failed to mark quotation as unread',
                error: error.message,
            });
        }
    },

    setQuotationReminder: async (req, res) => {
        const { id } = req.params;
        const { reminderDate } = req.body; // Format: "2025-01-15T14:30:00" or ISO string

        try {
            const updateData = {};

            if (reminderDate) {
                updateData.reminderDate = new Date(reminderDate);
                updateData.reminderSent = false;
            } else {
                updateData.reminderDate = null;
            }

            // Use findByIdAndUpdate to ensure the update is saved
            const quotation = await QuotationRequest.findByIdAndUpdate(
                id,
                { $set: updateData },
                { new: true, runValidators: true }
            );

            if (!quotation) {
                return res.status(404).json({ message: 'Quotation not found' });
            }

            res.status(200).json({
                message: reminderDate
                    ? 'Retargeting will run when reminderDate is reached (link job or send email).'
                    : 'Reminder cleared; automatic retargeting applies after 2 days without a reminder.',
                quotation
            });
        } catch (error) {
            console.error('Error setting quotation reminder:', error);
            res.status(500).json({
                message: 'Failed to set reminder',
                error: error.message,
            });
        }
    },
};

module.exports = quotationRequestController;
