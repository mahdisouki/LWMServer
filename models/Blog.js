const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
    title: { type: String, required: true },
<<<<<<< HEAD
    author: { type: String, required: true}, // Reference to a User model
    description: { type: String, required: true },
    image: { type: String, required: true }, // URL or path to the image
    date: { type: Date, default: Date.now }, // Automatically set to the current date
    tags: { type: [String] }, // Array of strings for tags
=======
    author: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String, required: true }, 
    date: { type: Date, default: Date.now }, 
>>>>>>> ba53a0a67228ad4612f6248632b7eb63957a962a
});

const Blog = mongoose.model('Blog', blogSchema);
module.exports = Blog;
