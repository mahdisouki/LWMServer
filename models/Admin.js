
const mongoose = require('mongoose');
const { User } = require('./User');

const adminSchema = new mongoose.Schema({});
const Admin = User.discriminator('Admin', adminSchema);

module.exports = Admin;