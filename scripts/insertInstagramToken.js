require('dotenv').config();
const mongoose = require('mongoose');
const InstagramToken = require('../models/InstagramToken');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Insert or update Instagram token
const insertInstagramToken = async () => {
  try {
    console.log('🚀 Inserting/Updating Instagram token...\n');

    const token = process.env.IG_TOKEN;
    if (!token) {
      throw new Error('IG_TOKEN not found in environment variables');
    }

    // Use upsert to insert or update
    const tokenDoc = await InstagramToken.findOneAndUpdate(
      { platform: 'instagram' },
      {
        platform: 'instagram',
        token: token,
        updatedAt: new Date()
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    console.log('✅ Instagram token inserted/updated successfully');
    console.log(`\n📊 Token Document:`);
    console.log(JSON.stringify(tokenDoc.toObject(), null, 2));

  } catch (error) {
    console.error('❌ Error inserting Instagram token:', error);
    throw error;
  }
};

// Run the insertion
const run = async () => {
  try {
    await connectDB();
    await insertInstagramToken();
    console.log('\n✅ Insertion completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Insertion failed:', error);
    process.exit(1);
  }
};

// Execute if run directly
if (require.main === module) {
  run();
}

module.exports = { insertInstagramToken };
