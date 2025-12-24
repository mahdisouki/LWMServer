const QuotationRequest = require('../models/QuotationRequest');
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

                Notes: comments || 'No additional comments',
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

            // Add date range if provided
            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) {
                    query.createdAt.$gte = new Date(startDate);
                }
                if (endDate) {
                    query.createdAt.$lte = new Date(endDate);
                }
            }

            // Calculate skip value for pagination
            const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

            // Build sort object
            const sort = {};
            sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

            // Execute query with pagination and sorting
            const quotations = await QuotationRequest
                .find(query)
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit, 10));

            // Get total count for pagination
            const total = await QuotationRequest.countDocuments(query);

            res.status(200).json({
                message: "All quotations retrieved successfully",
                quotations,
                meta: {
                    currentPage: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total,
                    count: quotations.length,
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

            res.status(200).json(quotation);
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

            const responsibleEmail = 'hello@londonwastemanagement.com';
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
};

module.exports = quotationRequestController;
