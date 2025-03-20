const QuotationRequest = require('../models/QuotationRequest');
const sendQuotationEmail = require('../utils/sendQuotationEmail'); // Utility function to send email notifications
const APIfeatures = require('../utils/APIFeatures');
const FormData = require('form-data')
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const axios = require('axios')

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
    
                const aiResponse = await axios.post('http://127.0.0.1:5000/predict', formData, {
                    headers: {
                        ...formData.getHeaders(),
                    },
                });
    
                if (aiResponse.data && aiResponse.data.predictions) {
                    predictions.push(...aiResponse.data.predictions);
                }
            }
    
            // Transform AI predictions into estimatedPrices format
            const estimatedPrices = predictions.map(pred => ({
                name: pred.classe,
                price: pred.price_inc_vat.toString(),
            }));
    
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
                estimatedPrices,
            });
    
            await newQuotation.save();
    
    
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
