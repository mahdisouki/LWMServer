require('dotenv').config();
const mongoose = require ('mongoose');

mongoose.connect("mongodb+srv://soukimahdi:londonwaste@clusterwaste.eytju.mongodb.net/?retryWrites=true&w=majority&appName=ClusterWaste")
.then(()=>{
console.log("DB connected!");
}).catch((err)=>console.log(err));

