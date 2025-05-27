const express = require("express");
const app = express();
require("dotenv").config();
const http = require("http");
const bodyParser = require('body-parser');
const fs = require("fs");
const TippingPlace = require('./models/TippingPlaces')
const mongoose=require('mongoose')
const { initSocket } = require("./socket");
const connectToDatabase = require("./config/db");
const { sendWasteTransferNoteEmail , sendGeneralInvoiceEmail , sendPartialPaymentNotification , sendBookingConfirmationEmail } = require("./services/emailsService");
const { handleStripeWebhook } = require('./controllers/taskCtrl');

const server = http.createServer(app); 
connectToDatabase()
  .then(() => {
    console.log("✅ MongoDB Connected");

    // ✅ Now it's safe to initialize sockets
    initSocket(server);

    // ✅ Load your routes, middleware, jobs, etc.
    require('./jobs/dailySheetCron');
    require('./jobs/AssignedStaffCron');
    // sendBookingConfirmationEmail("67e1e4c301ba1a14b5f9eba5")

  })
  .catch(err => {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1); // Exit safely if DB connection fails
  });

// initSocket(server);

const cors = require("cors");
const path = require("path");


require('./jobs/dailySheetCron'); 
require('./jobs/AssignedStaffCron');
const setupSwagger = require('./config/swaggerConfig'); 
// Apply raw body for Stripe webhook first



const corsOptions = {
  origin: ['https://dirverapp.netlify.app' , 'https://lwmadmin.netlify.app', 'https://localhost:5173' ,'http://localhost:5174'  ,'http://localhost:3001'], 
  optionsSuccessStatus: 200 
};

app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/public/:fileName', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.params.fileName);
  if (fs.existsSync(filePath)) {
    res.download(filePath); // Envoie le fichier au client
  } else {
    res.status(404).send('File not found');
  }
});

// Stripe Webhook Route - Raw body middleware is applied ONLY for this route
app.post(
  '/api/webhooks/stripe',
  bodyParser.raw({ type: 'application/json' }),
  handleStripeWebhook
);

app.use(cors(corsOptions));
// Apply JSON parsing for all other routes
app.use(express.json());
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' https://*.stripe.com https://*.paypal.com https://*.paypalobjects.com 'unsafe-inline' 'unsafe-eval' blob:; " +
    "style-src 'self' https://*.paypal.com https://*.paypalobjects.com 'unsafe-inline'; " +
    "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com; " +
    "frame-src https://*.stripe.com https://*.paypal.com; " +
    "connect-src 'self' https://*.stripe.com https://*.paypal.com;"
  );
  next();
});
// Import routes
const taskRouter = require("./routes/task");
const authRouter = require("./routes/auth");
const staffRouter = require("./routes/staff");
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
const notificationRoutes = require('./routes/notification');
const emailTemplateRoutes = require('./routes/emailTemplate');
const logRouter = require('./routes/log');
const {optimizeRoute } = require("./helper/OpitomRoute");

setupSwagger(app); 
app.use("/api", taskRouter);
app.use('/api',authRouter);
app.use('/api',staffRouter);
app.use('/api',logRouter);
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
app.use('/api' , serviceCategoryRoutes);
app.use('/api' , notificationRoutes);
app.use('/api' , emailTemplateRoutes)
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

// startMailListener();

server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});
