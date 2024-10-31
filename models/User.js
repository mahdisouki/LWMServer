const mongoose = require('mongoose');


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
  address:{type:String},
  CIN: {type:String},
  DriverLicense:{type:String},
  addressProof:{type:String},
  NatInsurance:{type:String},
  refreshToken: { type: String },
  dayOffRequests: [
    {
      type: mongoose.Types.ObjectId,
      ref: 'Dayoff'
    }
  ]
}, { discriminatorKey: 'roleType' });


const User = mongoose.model('User', userSchema);

module.exports =  {User};
