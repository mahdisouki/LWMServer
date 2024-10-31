const mongoose = require('mongoose');

// Break schema to store individual break entries
const breakSchema = new mongoose.Schema({
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: false },
  duration: { type: Number, required: false } // Duration in minutes
});

const userSchema = new mongoose.Schema({
  
  email: { type: String, required: true, unique: true },
  officialEmail: { type: String},
  phoneNumber: [{ type: String, required: true }],
  username: { type: String , required: true },
  gender: {
    type: String,
    enum: ["Female", "Male", "Other"],
    default: "Other",
  },
  designation:{ type: String},
  dateOfBirth: { type: Date },
  picture: { type: String },
  password: { type: String, required: true },
  role: {
    type: [String],
    enum: ["Admin", "Helper", "Driver", "HR" ,"Manager" ,"CM" ,"IT" ,"CEO"] 
  },
  refreshToken: { type: String },
  dayOffRequests: [
    {
      type: mongoose.Types.ObjectId,
      ref: 'Dayoff'
    }
  ],
  breaks: [breakSchema],
}, { discriminatorKey: 'roleType' });


const User = mongoose.model('User', userSchema);

module.exports =  {User};
