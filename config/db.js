require('dotenv').config();
const mongoose = require('mongoose');

function connectToDatabase() {
  return mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

module.exports = connectToDatabase;

