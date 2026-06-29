require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const { resolveIsBusinessEmail } = require('../utils/businessEmail');

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('MONGO_URI or MONGODB_URI missing in .env');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');
};

async function backfillIsBusinessEmail() {
  const cursor = Task.find({ email: { $exists: true, $nin: [null, ''] } })
    .select('_id email isBusinessEmail excludedFromBusinessList')
    .cursor();

  let updated = 0;
  for await (const task of cursor) {
    const next = resolveIsBusinessEmail(
      task.email,
      task.excludedFromBusinessList,
    );
    if (task.isBusinessEmail !== next) {
      await Task.updateOne({ _id: task._id }, { $set: { isBusinessEmail: next } });
      updated += 1;
    }
  }

  console.log(`Backfill complete. Updated ${updated} task(s).`);
}

connectDB()
  .then(backfillIsBusinessEmail)
  .then(() => mongoose.disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
