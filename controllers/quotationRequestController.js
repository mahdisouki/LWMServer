const QuotationRequest = require('../models/QuotationRequest');
const sendQuotationEmail = require('../utils/sendQuotationEmail'); // Utility function to send email notifications

const quotationRequestController = {
    createQuotationRequest: async (req, res) => {
        try {
            // Extract data from request body
            const {
                firstName,
                lastName,
                email,
                phoneNumber,
                doorNumberOrBuildingName,
                roadName,
                town,
                postcode,
                comments
            } = req.body;

            // Get file URLs directly from req.files populated by multer
            const items = req.files.map((file) => file.path);

            // Create a new quotation request
            const newQuotation = new QuotationRequest({
                firstName,
                lastName,
                email,
                phoneNumber,
                doorNumberOrBuildingName,
                roadName,
                town,
                postcode,
                comments,
                items: items
            });

            // Save the quotation request to the database
            await newQuotation.save();

            // Send an email notification to the responsible party
            await sendQuotationEmail({
                responsibleEmail: process.env.RESPONSIBLE_EMAIL, // Responsible's email
                quotationData: newQuotation
            });

            res.status(201).json({ message: "Quotation request submitted successfully", quotation: newQuotation });
        } catch (error) {
            console.error('Error creating quotation request:', error);
            res.status(500).json({ message: "Failed to submit quotation request", error: error.message });
        }
    },

    getAllQuotations: async (req, res) => {
        try {
            const quotations = await QuotationRequest.find();
            res.status(200).json(quotations);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve quotations", error: error.message });
        }
    },

    getQuotationById: async (req, res) => {
        const { id } = req.params;
        try {
            const quotation = await QuotationRequest.findById(id);
            if (!quotation) {
                return res.status(404).json({ message: "Quotation not found" });
            }
            res.status(200).json(quotation);
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve quotation", error: error.message });
        }
    }
};

module.exports = quotationRequestController;
