require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');

const TARGET_EMAIL = 'eyatrk24@gmail.com';

async function connectDB() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }

  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

async function setAllTaskEmails() {
  console.log(`🚀 Updating all task emails to: ${TARGET_EMAIL}`);

  const totalTasks = await Task.countDocuments({});
  const alreadyTarget = await Task.countDocuments({ email: TARGET_EMAIL });

  console.log(`📊 Total tasks: ${totalTasks}`);
  console.log(`📊 Tasks already using target email: ${alreadyTarget}`);

  const result = await Task.updateMany(
    {},
    { $set: { email: TARGET_EMAIL } },
  );

  const matchedCount = result.matchedCount ?? result.n ?? 0;
  const modifiedCount = result.modifiedCount ?? result.nModified ?? 0;

  console.log(`✅ Matched tasks: ${matchedCount}`);
  console.log(`✅ Modified tasks: ${modifiedCount}`);
}

async function run() {
  try {
    await connectDB();
    console.log('✅ MongoDB Connected');
    await setAllTaskEmails();
    await mongoose.connection.close();
    console.log('✅ Done');
    process.exit(0);
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    try {
      await mongoose.connection.close();
    } catch (_) {
      // ignore close errors
    }
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { setAllTaskEmails };
