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
const Coupon = require('../models/Coupon');
const { sendQuotationRetargetingEmail } = require('../utils/sendQuotationRetargetingEmail');
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
                reason,
                status, // 'accepted', 'rejected', 'pending'
                statusDateStart, // Filter by status date (Task createdAt for accepted, QuotationRequest updatedAt for rejected)
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

            // Add reason filter if provided
            if (reason) {
                if (reason === 'other') {
                    // When filtering by "other", filter by customReason field
                    query.reason = 'other';
                    query.customReason = { $exists: true, $ne: null, $ne: '' };
                } else {
                    // For predefined reasons, filter by reason field
                    query.reason = reason;
                }
            }

            // Build sort object
            const sort = {};
            sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

            // If status or statusDate filtering is needed, fetch all matching quotations first
            // Otherwise, apply pagination at database level for better performance
            const needsStatusFiltering = status || statusDateStart || statusDateEnd;

            let quotations;
            if (needsStatusFiltering) {
                // Fetch all quotations matching the base query (no pagination yet)
                quotations = await QuotationRequest.find(query).sort(sort);
            } else {
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
                quotationId: { $in: quotationIds }
            }).select('quotationId createdAt');

            // Create a Map of quotationId -> Task createdAt for quick lookup
            const quotationsWithOrders = new Map();
            tasksWithQuotations.forEach(task => {
                if (task.quotationId) {
                    const quotationIdStr = task.quotationId.toString();
                    // If multiple tasks exist, keep the earliest one (first order)
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

                // Use the model's instance method to compute status
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
                    if (!q.statusDate) return false; // Skip pending quotes without statusDate

                    const statusDate = new Date(q.statusDate);
                    if (statusDateStart && statusDate < new Date(statusDateStart)) return false;
                    if (statusDateEnd && statusDate > new Date(statusDateEnd)) return false;
                    return true;
                });
            }

            // Get total count before pagination (for accurate pagination metadata)
            const total = quotationsWithStatus.length;

            // Apply pagination if status filtering was applied
            if (needsStatusFiltering) {
                const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
                quotationsWithStatus = quotationsWithStatus.slice(skip, skip + parseInt(limit, 10));
            }

            res.status(200).json({
                message: "All quotations retrieved successfully",
                quotations: quotationsWithStatus,
                meta: {
                    currentPage: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total,
                    count: quotationsWithStatus.length,
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

            const responsibleEmail = 'eyatrk24@gmail.com';
            const sendContactEmail = require('../utils/sendContactEmail');
            await sendContactEmail({ responsibleEmail, contactData });

            res.status(200).json({ message: 'Moving service email sent successfully.' });
        } catch (error) {
            console.error('Error sending moving service email:', error);
            res.status(500).json({ message: 'Failed to send moving service email', error: error.message });
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

    updateQuotation: async (req, res) => {
        const { id } = req.params;
        const { reason, customReason } = req.body;

        try {
            // First, get the existing quotation to check its current state
            const existingQuotation = await QuotationRequest.findById(id);

            if (!existingQuotation) {
                return res.status(404).json({ message: 'Quotation not found' });
            }

            // Validate reason if provided
            if (reason !== undefined && !['no response', 'price too high', 'other'].includes(reason)) {
                return res.status(400).json({
                    message: 'Invalid reason. Must be one of: no response, price too high, other'
                });
            }

            // Build update object
            const updateData = {};

            // Handle reason updates
            if (reason !== undefined) {
                updateData.reason = reason;

                // If reason is being set to 'other' for the first time, customReason is required
                if (reason === 'other' && existingQuotation.reason !== 'other' && !customReason) {
                    return res.status(400).json({
                        message: 'customReason is required when reason is "other"'
                    });
                }

                // Clear customReason if reason is being changed to something other than 'other'
                if (reason !== 'other') {
                    updateData.customReason = null;
                }
            }

            // Handle customReason updates
            if (customReason !== undefined) {
                // Determine what the final reason will be
                const finalReason = reason !== undefined ? reason : existingQuotation.reason;

                if (finalReason === 'other') {
                    // Allow updating customReason when reason is 'other'
                    updateData.customReason = customReason || null;
                } else {
                    // If reason is not 'other', don't allow setting customReason
                    // But allow clearing it if it exists
                    if (customReason && customReason.trim() !== '') {
                        return res.status(400).json({
                            message: 'customReason can only be set when reason is "other"'
                        });
                    }
                    // If customReason is empty/null, allow clearing it
                    updateData.customReason = null;
                }
            }

            const quotation = await QuotationRequest.findByIdAndUpdate(
                id,
                updateData,
                { new: true, runValidators: true }
            );

            // Check if we need to send retargeting email
            // Send email if reason is set to "price too high" or "no response" and email hasn't been sent yet
            const finalReason = reason !== undefined ? reason : existingQuotation.reason;
            const shouldSendEmail = (finalReason === 'price too high' || finalReason === 'no response') &&
                !existingQuotation.retargetingEmailSent &&
                quotation.email;

            if (shouldSendEmail) {
                try {
                    // Generate unique coupon codes
                    const timestamp = Date.now().toString().slice(-8);
                    const coupon20Code = `QUOTE20${timestamp}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
                    const coupon10Code = `QUOTE10${timestamp}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

                    // Calculate expiration dates
                    const emailSentAt = new Date();
                    const expiresAt20Percent = new Date(emailSentAt);
                    expiresAt20Percent.setHours(expiresAt20Percent.getHours() + 24); // 24 hours from now

                    const expiresAt10Percent = new Date(emailSentAt);
                    expiresAt10Percent.setHours(expiresAt10Percent.getHours() + 72); // 72 hours from now

                    // Create 20% coupon (24 hours, single use)
                    const coupon20 = new Coupon({
                        code: coupon20Code.toUpperCase(),
                        percentage: 20,
                        expirationDuration: 24,
                        expiresAt: expiresAt20Percent,
                        description: `Quotation retargeting coupon (20%) for quotation ${quotation._id}`,
                        maxUsage: 1, // Single use only
                        isActive: true
                    });
                    await coupon20.save();

                    // Create 10% coupon (72 hours, single use)
                    const coupon10 = new Coupon({
                        code: coupon10Code.toUpperCase(),
                        percentage: 10,
                        expirationDuration: 72,
                        expiresAt: expiresAt10Percent,
                        description: `Quotation retargeting coupon (10%) for quotation ${quotation._id}`,
                        maxUsage: 1, // Single use only
                        isActive: true
                    });
                    await coupon10.save();

                    // Send retargeting email
                    await sendQuotationRetargetingEmail({
                        customerEmail: quotation.email,
                        customerName: quotation.Name,
                        coupon20Code: coupon20.code,
                        coupon10Code: coupon10.code,
                        expiresAt20: expiresAt20Percent,
                        expiresAt10: expiresAt10Percent
                    });

                    // Update quotation with email sent flag and coupon IDs
                    quotation.retargetingEmailSent = true;
                    quotation.retargetingEmailSentAt = emailSentAt;
                    quotation.retargetingCoupon20Id = coupon20._id;
                    quotation.retargetingCoupon10Id = coupon10._id;
                    await quotation.save();

                    console.log(`Retargeting email sent for quotation ${quotation._id} with coupons: ${coupon20.code} and ${coupon10.code}`);
                } catch (emailError) {
                    console.error('Error sending retargeting email for quotation:', emailError);
                    // Don't fail the request if email fails, but log the error
                }
            }

            res.status(200).json({
                message: 'Quotation updated successfully',
                quotation
            });
        } catch (error) {
            res.status(500).json({
                message: 'Failed to update quotation',
                error: error.message,
            });
        }
    },
};

module.exports = quotationRequestController;
