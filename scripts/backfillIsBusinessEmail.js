require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const {
  resolveIsBusinessEmail,
  extractEmailDomain,
  loadExtraFreeEmailDomains,
} = require('../utils/businessEmail');

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
  const extraCount = await loadExtraFreeEmailDomains();
  console.log(`Loaded ${extraCount} extra free email domain(s) from DB`);

  const cursor = Task.find({ email: { $exists: true, $nin: [null, ''] } })
    .select('_id email isBusinessEmail excludedFromBusinessList')
    .cursor();

  let scanned = 0;
  let updated = 0;
  const flippedOffByDomain = {};

  for await (const task of cursor) {
    scanned += 1;
    const next = resolveIsBusinessEmail(
      task.email,
      task.excludedFromBusinessList,
    );
    if (task.isBusinessEmail !== next) {
      await Task.updateOne({ _id: task._id }, { $set: { isBusinessEmail: next } });
      updated += 1;
      if (task.isBusinessEmail === true && next === false) {
        const domain = extractEmailDomain(task.email);
        flippedOffByDomain[domain] = (flippedOffByDomain[domain] || 0) + 1;
      }
    }
    if (scanned % 1000 === 0) {
      console.log(`… scanned ${scanned}, updated ${updated}`);
    }
  }

  console.log(`Backfill complete. Scanned ${scanned}, updated ${updated} task(s).`);
  const notable = ['me.com', 'btinternet.com'];
  for (const domain of notable) {
    const count = flippedOffByDomain[domain] || 0;
    if (count > 0) {
      console.log(`  ${domain}: set isBusinessEmail=false on ${count} task(s)`);
    }
  }
}

connectDB()
  .then(backfillIsBusinessEmail)
  .then(() => mongoose.disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
