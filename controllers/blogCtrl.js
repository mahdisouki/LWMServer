// controllers/blogController.js
const Blog = require('../models/Blog');
const APIfeatures = require('../utils/APIFeatures'); // If you're using a utility for API features

const blogCtrl = {
    createBlog: async (req, res) => {
        try {
            const { title, author, description } = req.body;
            const image = req.file.path; // Assuming the image is uploaded via Cloudinary

            const newBlog = new Blog({ title, author, description, image });
            await newBlog.save();
            res.status(201).json({ message: "Blog post created successfully", blog: newBlog });
        } catch (error) {
            res.status(500).json({ message: "Failed to create blog post", error: error.message });
        }
    },
    
    getAllBlogs: async (req, res) => {
        try {
            const { page = 1, limit = 9, filters } = req.query; // Support pagination and filtering
            let query = Blog.find().populate('author', 'name'); // Populating author name

            const features = new APIfeatures(query, req.query);
            if (filters) {
                features.filtering(); // Implement filtering if applicable
            }
            features.sorting().paginating();
            const blogs = await features.query.exec();
            const total = await Blog.countDocuments(features.query.getFilter());
            const currentPage = parseInt(req.query.page, 10) || 1;
            const limitNum = parseInt(req.query.limit, 10) || 9;

            res.status(200).json({
                message: "All blogs retrieved successfully",
                blogs,
                meta: {
                    currentPage,
                    limit: limitNum,
                    total,
                    count: blogs.length,
                },
            });
        } catch (error) {
            res.status(500).json({ message: "Failed to retrieve blogs", error: error.message });
        }
    },

    getBlogById: async (req, res) => {
        const { id } = req.params;
        try {
            const blog = await Blog.findById(id).populate('author', 'name');
            if (!blog) {
                return res.status(404).json({ message: "Blog post not found" });
            }
            res.status(200).json(blog);
        } catch (error) {
            res.status(500).json({ message: "Failed to fetch blog post", error: error.message });
        }
    },

    updateBlog: async (req, res) => {
        const { id } = req.params;
        const { title, description, author } = req.body;
        const image = req.file ? req.file.path : undefined; // Utiliser la nouvelle image si téléchargée
    
        // Création d'un objet de mise à jour dynamique
        const updates = {};
        if (title) updates.title = title;
        if (description) updates.description = description;
        if (author) updates.author = author;
        if (image) updates.image = image;
    
        try {
            // Mise à jour uniquement des champs présents dans `updates`
            const updatedBlog = await Blog.findByIdAndUpdate(id, updates, { new: true });
            if (!updatedBlog) {
                return res.status(404).json({ message: "Blog post not found" });
            }
            res.status(200).json({ message: "Blog post updated successfully", blog: updatedBlog });
        } catch (error) {
            res.status(500).json({ message: "Failed to update blog post", error: error.message });
        }
    },    

    deleteBlog: async (req, res) => {
        const { id } = req.params;
        try {
            const blog = await Blog.findByIdAndDelete(id);
            if (!blog) {
                return res.status(404).json({ message: "Blog post not found" });
            }
            res.status(200).json({ message: "Blog post deleted successfully" });
        } catch (error) {
            res.status(500).json({ message: "Failed to delete blog post", error: error.message });
        }
    },
};

module.exports = blogCtrl;
