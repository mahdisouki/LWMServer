const QuotationRequest = require('../models/QuotationRequest');
const sendQuotationEmail = require('../utils/sendQuotationEmail'); // Utility function to send email notifications
const APIfeatures = require('../utils/APIFeatures');
const FormData = require('form-data')
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const axios = require('axios');
const { emitNotificationToUser } = require('../socket');
const quotationRequestController = {
    createQuotationRequest : async (req, res) => {
        try {
            const {
                firstName,
                lastName,
                DoorNumber,
                RoadName,
                email,
                phoneNumber,
                Town,
                postcode,
                comments,
            } = req.body;
            console.log("req.body",req.body)
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: "No files uploaded" });
            }
    
            const items = req.files.map((file) => file.path);
            const predictions = [];
    
            // Download the image from Cloudinary and send it to the Flask API
            for (const file of req.files) {
                const response = await fetch(file.path); // Download the file from Cloudinary
                const arrayBuffer = await response.arrayBuffer(); // Convert to ArrayBuffer
                const buffer = Buffer.from(arrayBuffer); // Convert to Buffer for formData
    
                const formData = new FormData();
                formData.append('file', buffer, {
                    filename: file.originalname,
                    contentType: file.mimetype,
                });
    
                // const aiResponse = await axios.post('http://127.0.0.1:5000/predict', formData, {
                //     headers: {
                //         ...formData.getHeaders(),
                //     },
                // });
    
                // if (aiResponse.data && aiResponse.data.predictions) {
                //     predictions.push(...aiResponse.data.predictions);
                // }
            }
    
            // Transform AI predictions into estimatedPrices format
            // const estimatedPrices = predictions.map(pred => ({
            //     name: pred.classe,
            //     price: pred.price_inc_vat.toString(),
            // }));
    
            const newQuotation = new QuotationRequest({
                Name: `${firstName} ${lastName}`,
                DoorNumber,
                RoadName,
                Town,
                email,
                phoneNumber,
                postcode,
                comments,
                items,
                // estimatedPrices,
            });
    
            await newQuotation.save();
            emitNotificationToUser("67cb6810c9e768ec25d39523", "New Quotation Request", "A new quotation request has been submitted");
    
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
                        { Town: { $regex: keyword, $options: 'i' } },
                        { RoadName: { $regex: keyword, $options: 'i' } }
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
                DoorNumber,
                RoadName,
                email,
                phoneNumber,
                Town,
                postcode,
                comments,
            } = req.body;

            // Compose the address lines for the email template
            const line1 = `${DoorNumber} ${RoadName}`;
            const line2 = Town;

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
            console.log("req.body",req.body)
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

            const responsibleEmail = 'soukimahdi@gmail.com';
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
