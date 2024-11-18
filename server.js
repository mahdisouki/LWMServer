const express = require("express");
const app = express();
const https = require("https");
const fs = require("fs");

// SSL certificate and key
const privateKey = fs.readFileSync("./certs/192.168.62.131-key.pem", "utf8");
const certificate = fs.readFileSync("./certs/192.168.62.131.pem", "utf8");

const credentials = { key: privateKey, cert: certificate };

const { initSocket } = require("./socket");

const server = https.createServer(credentials, app); 

initSocket(server);

require("dotenv").config();
require("./config/db");
const cors = require("cors");

require('./jobs/dailySheetCron'); 
require('./jobs/AssignedStaffCron');
const setupSwagger = require('./config/swaggerConfig'); 

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
const corsOptions = {
  origin: '*', 
  optionsSuccessStatus: 200 
};

app.use(cors(corsOptions));
setupSwagger(app); 
app.use(express.json());
app.use('/api',authRouter);
app.use('/api',staffRouter);
app.use('/api',taskRouter);
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
app.use('/api/gmail', gmailRoutes);
app.use('/api/blog',blogRoutes);
app.use('/api',storageRoutes)
app.use('/api', statsRoute)




server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});