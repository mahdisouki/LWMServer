const express = require("express");
const app = express();
const http = require("http");

require("dotenv").config();
require("./config/db");
const cors = require("cors");
const Message = require("./models/Message");
const { initSocket, emitEvent } = require("./socket");
const server = http.createServer(app);
const io = initSocket(server);
const Driver = require("./models/Driver");
const authRouter = require("./routes/auth");
const staffRouter = require("./routes/staff");
const taskRouter = require("./routes/task");
const truckRouter = require("./routes/truck");
const driverRouter = require("./routes/driver");
const tippingRouter = require("./routes/tipping");
const dayoffRouter = require("./routes/dayoff");
const dailySheetRoutes = require("./routes/dailySheet");
const payrollsRoutes = require("./routes/payrolls");
app.use(cors());
app.use(express.json());
app.use("/api", authRouter);
app.use("/api", staffRouter);
app.use("/api", taskRouter);
app.use("/api", truckRouter);
app.use("/api", driverRouter);
app.use("/api", tippingRouter);
app.use("/api", dayoffRouter);
app.use("/api/dailySheets", dailySheetRoutes);
app.use("/api", payrollsRoutes);

server.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`);
});
