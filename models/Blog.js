const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true},
    description: { type: String, required: true },
    image: { type: String, required: true }, 
    date: { type: Date, default: Date.now },
    tags: { type: [String]  , index: true}, 

});

const Blog = mongoose.model('Blog', blogSchema);
module.exports = Blog;
