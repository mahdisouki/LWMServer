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

// Initialize Instagram token in database
const initInstagramToken = async () => {
  try {
    console.log('🚀 Initializing Instagram token...\n');

    const token = process.env.IG_TOKEN;
    if (!token) {
      throw new Error('IG_TOKEN not found in environment variables');
    }

    // Check if token already exists
    let tokenDoc = await InstagramToken.findOne({ platform: 'instagram' });

    if (tokenDoc) {
      console.log('⚠️  Instagram token already exists in database');
      console.log('   Updating with new token from environment...');
      tokenDoc.token = token;
      tokenDoc.updatedAt = new Date();
      await tokenDoc.save();
      console.log('✅ Instagram token updated successfully');
    } else {
      console.log('📝 Creating new Instagram token record...');
      tokenDoc = await InstagramToken.create({
        platform: 'instagram',
        token: token
      });
      console.log('✅ Instagram token created successfully');
    }

    console.log(`\n📊 Token Info:`);
    console.log(`   Platform: ${tokenDoc.platform}`);
    console.log(`   Token: ${tokenDoc.token.substring(0, 20)}...`);
    console.log(`   Updated: ${tokenDoc.updatedAt}`);
    if (tokenDoc.expiresAt) {
      console.log(`   Expires: ${tokenDoc.expiresAt}`);
    }

  } catch (error) {
    console.error('❌ Error initializing Instagram token:', error);
    throw error;
  }
};

// Run the initialization
const run = async () => {
  try {
    await connectDB();
    await initInstagramToken();
    console.log('\n✅ Initialization completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Initialization failed:', error);
    process.exit(1);
  }
};

// Execute if run directly
if (require.main === module) {
  run();
}

module.exports = { initInstagramToken };
