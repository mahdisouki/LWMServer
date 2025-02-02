const QuotationRequest = require('../models/QuotationRequest');
const sendQuotationEmail = require('../utils/sendQuotationEmail'); // Utility function to send email notifications
const APIfeatures = require('../utils/APIFeatures');

const quotationRequestController = {
    createQuotationRequest: async (req, res) => {
        try {
            const {
                line1,
                line2,
                email,
                phoneNumber,

                companyName,
                postcode,
                comments,
            } = req.body;

            const items = req.files.map((file) => file.path);

            const newQuotation = new QuotationRequest({
                line1,
                line2,
                email,
                phoneNumber,

                companyName,
                postcode,
                comments,
                items: items,
            });

            await newQuotation.save();

            // Send email to the responsible party and automatic reply to the user
            await sendQuotationEmail({
                responsibleEmail: process.env.RESPONSIBLE_EMAIL,
                quotationData: newQuotation,
            });

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

    // getAllQuotations: async (req, res) => {
    //     try {
    //         const quotations = await QuotationRequest.find();
    //         res.status(200).json(quotations);
    //     } catch (error) {
    //         res.status(500).json({
    //             message: 'Failed to retrieve quotations',
    //             error: error.message,
    //         });
    //     }
    // },
    getAllQuotations: async (req, res) => {
        try {
            const { page = 1, limit = 10 } = req.query;

            let query = QuotationRequest.find();
            const features = new APIfeatures(query, req.query);
            features.sorting().paginating();

            const quotations = await features.query.exec();
            const total = await QuotationRequest.countDocuments(features.query.getFilter());

            res.status(200).json({
                message: "All quotations retrieved successfully",
                quotations,  // <== Now it's inside an object
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
};

module.exports = quotationRequestController;
