const express = require("express");
const app = express();
const http = require("http");

const { initSocket } = require("./socket");

const server = http.createServer(app);

const io = initSocket(server);

require("dotenv").config();
require("./config/db");
const cors = require("cors");

require('./jobs/dailySheetCron'); 
require('./jobs/AssignedStaffCron');


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
const gmailRoutes = require('./routes/gmail')
const refundRoutes = require('./routes/refund')
const paymentHistoRoutes = require('./routes/paymenthisto')

const corsOptions = {
  origin: '*', 
  optionsSuccessStatus: 200 
};

app.use(cors(corsOptions));

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
app.use('/api/tippingPlaces' , tippingPlacesRoutes)
app.use('/api/blockingDays' , blockingDaysRoutes)
app.use('/api/standard' , standardItemsRoutes)
app.use('/api/refund' , refundRoutes)
app.use('/api/payment' , paymentHistoRoutes)
app.use('/api/gmail', gmailRoutes); // Register Gmail routes

server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});