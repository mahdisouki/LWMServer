const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true}, // Reference to a User model
    description: { type: String, required: true },
    image: { type: String, required: true }, // URL or path to the image
    date: { type: Date, default: Date.now }, // Automatically set to the current date
    tags: { type: [String]  , index: true}, // Array of strings for tags

});

const Blog = mongoose.model('Blog', blogSchema);
module.exports = Blog;
