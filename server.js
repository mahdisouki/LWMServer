const express = require("express");
const app = express();
const http = require("http");
const bodyParser = require('body-parser');
const fs = require("fs");


const { initSocket } = require("./socket");



const server = http.createServer(app); 

initSocket(server);

require("dotenv").config();
require("./config/db");
const cors = require("cors");

require('./jobs/dailySheetCron'); 
require('./jobs/AssignedStaffCron');
const setupSwagger = require('./config/swaggerConfig'); 
// Apply raw body for Stripe webhook first

app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

const corsOptions = {
  origin: ['*' , 'https://dirverapp.netlify.app' , 'https://lwmadmin.netlify.app', 'https://localhost:5173' , 'http://localhost:5174', 'https://londonwastemanagement.netlify.app'], 
  optionsSuccessStatus: 200 
};
app.use(cors(corsOptions));
const authRouter = require("./routes/auth");
const staffRouter = require("./routes/staff");
const taskRouter = require("./routes/task");
const truckRouter = require("./routes/truck");
const driverRouter = require("./routes/driver");
const tippingRouter = require("./routes/tipping");
const dayoffRouter = require("./routes/dayoff");
const dailySheetRoutes = require("./routes/dailySheet");
const payrollsRoutes = require("./routes/payrolls");
const messageRoutes = require("./routes/messages");
const tippingPlacesRoutes = require('./routes/tippingPlaces')
const blockingDaysRoutes = require('./routes/blockingDays')
const standardItemsRoutes = require('./routes/standardItems')
const uploadRouter = require('./routes/upload');
const statsRoute = require("./routes/stats");
const gmailRoutes = require('./routes/gmail')
const refundRoutes = require('./routes/refund')
const paymentHistoRoutes = require('./routes/paymenthisto')
const blogRoutes = require('./routes/blog')
const storageRoutes = require('./routes/storage')
const quotationRoutes = require('./routes/quotationRoutes')
const contactRequestRoutes = require('./routes/contactRequestRoutes');
const serviceCategoryRoutes = require('./routes/serviceCategory');
const {optimizeRoute } = require("./helper/OpitomRoute");




// Apply JSON parsing globally for other routes
app.use(express.json());
app.use(bodyParser.json());

// Mount routes
app.use('/api', taskRouter);


setupSwagger(app); 

app.use('/api',authRouter);
app.use('/api',staffRouter);

app.use('/api',truckRouter);
app.use('/api',driverRouter);
app.use("/api", tippingRouter);
app.use("/api", dayoffRouter);
app.use("/api/dailySheets", dailySheetRoutes);
app.use("/api", payrollsRoutes);
app.use("/api", messageRoutes);
app.use('/api/tippingPlaces', tippingPlacesRoutes);
app.use('/api/blockingDays' , blockingDaysRoutes)
app.use('/api/standard' , standardItemsRoutes)
app.use('/api/refund' , refundRoutes)
app.use('/api/payment' , paymentHistoRoutes)
app.use('/api/upload', uploadRouter)
app.use('/api', quotationRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/blog',blogRoutes);
app.use('/api',storageRoutes)
app.use('/api', statsRoute)
app.use('/api', contactRequestRoutes);
app.use('/api' , serviceCategoryRoutes)

app.post('/optimise/:truckId' , async(req,res)=>{
  try {
    const {truckId} = req.params;
    console.log(truckId)
    const response = await optimizeRoute(truckId , "2024-12-03");
    res.json({response:response})
  } catch (error) {
    console.log(error)
    res.json({error:error})
  }
})
server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});
