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
  address:{type:String},
  CIN: {type:String},
  DriverLicense:{type:String},
  addressProof:{type:String},
  NatInsurance:{type:String},
  refreshToken: { type: String },
  fcmToken: { type: String },
  totalHoursWorked:{
    type:Number,
    default:0
  },
  totalSalary:{
    type:Number,
    default:0
  },
  dayOffRequests: [
    {
      type: mongoose.Types.ObjectId,
      ref: 'Dayoff'
    }
  ],
  hourPrice:{
    type:Number,
    default:0
  },
  breaks: [breakSchema],
}, { discriminatorKey: 'roleType' });


const User = mongoose.model('User', userSchema);

module.exports =  {User};
