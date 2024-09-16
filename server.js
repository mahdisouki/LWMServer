const express = require('express')
const app = express()
require('dotenv').config();
require('./config/db');
const cors = require('cors');


const authRouter = require('./routes/auth');
const staffRouter =require('./routes/staff');
const taskRouter =require('./routes/task');
const truckRouter =require('./routes/truck');
const driverRouter =require('./routes/driver');

app.use(cors());
app.use(express.json());
app.use('/api',authRouter);
app.use('/api',staffRouter);
app.use('/api',taskRouter);
app.use('/api',truckRouter);
app.use('/api',driverRouter);


app.listen(process.env.port, () => {
  console.log(`LondonWaste app listening on port ${process.env.port}`)
})