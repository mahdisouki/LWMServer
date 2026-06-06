require('dotenv').config();
const mongoose = require('mongoose');
const QuotationRequest = require('../models/QuotationRequest');
const Coupon = require('../models/Coupon');
const { sendRetargetingEmail } = require('../utils/sendRetargetingEmail');
const {
  hasRetargetingEmailSentForQuotationEmail,
  suppressQuotationRetargetingAsDuplicate,
} = require('../services/quotationRetargetingService');
const { normalizeEmail } = require('../services/quotationTaskMatchingService');

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

// Generate unique 8-character coupon code
const generateCouponCode = async () => {
  let code;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    code = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const existing = await Coupon.findOne({ code });
    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error('Failed to generate unique coupon code after multiple attempts');
  }

  return code;
};

// Calculate total from estimatedPrices
const calculateTotalFromEstimatedPrices = (estimatedPrices) => {
  if (!estimatedPrices || !Array.isArray(estimatedPrices)) {
    return 0;
  }

  let subtotal = 0;
  estimatedPrices.forEach((item) => {
    const price = parseFloat(item.price) || 0;
    subtotal += price;
  });

  // Add VAT (20%)
  const vat = subtotal * 0.2;
  const total = subtotal + vat;

  return total;
};

// Convert quotation items to email format
const convertQuotationItemsToEmailFormat = (quotation) => {
  const items = [];
  
  // Use estimatedPrices if available
  if (quotation.estimatedPrices && quotation.estimatedPrices.length > 0) {
    quotation.estimatedPrices.forEach((estPrice, index) => {
      items.push({
        object: estPrice.name || `Item ${index + 1}`,
        price: parseFloat(estPrice.price) || 0,
        quantity: 1,
        Objectsposition: 'Outside the property', // Default position
        standardItemId: null // Quotation items don't have standardItemId
      });
    });
  } else if (quotation.items && quotation.items.length > 0) {
    // Fallback to items array if estimatedPrices not available
    quotation.items.forEach((itemName, index) => {
      items.push({
        object: itemName || `Item ${index + 1}`,
        price: 0, // No price available
        quantity: 1,
        Objectsposition: 'Outside the property',
        standardItemId: null
      });
    });
  }

  return items;
};

// Extract firstName and lastName from Name
const parseName = (fullName) => {
  if (!fullName) {
    return { firstName: '', lastName: '' };
  }

  const nameParts = fullName.trim().split(/\s+/);
  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: '' };
  }

  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');

  return { firstName, lastName };
};

// Main function to send retargeting emails
const sendQuotationRetargetingEmails = async () => {
  try {
    console.log('🚀 Starting retargeting email script...\n');

    // Find quotations with reason 'no response' or 'price too high' that haven't been sent
    const quotations = await QuotationRequest.find({
      reason: { $in: ['no response', 'price too high'] },
      retargetingEmailSent: { $ne: true }
    }).sort({ createdAt: 1 });

    if (quotations.length === 0) {
      console.log('✅ No quotations found that need retargeting emails.');
      return;
    }

    console.log(`📧 Found ${quotations.length} quotation(s) to process\n`);

    const MINIMUM_TOTAL = 45; // Minimum fee in GBP
    let successCount = 0;
    let errorCount = 0;
    let duplicateEmailsSkipped = 0;
    const processedEmails = new Set();

    for (const quotation of quotations) {
      try {
        const emailKey = normalizeEmail(quotation.email);

        if (emailKey && processedEmails.has(emailKey)) {
          await suppressQuotationRetargetingAsDuplicate(quotation);
          duplicateEmailsSkipped += 1;
          console.log(`   ⏭️  Skipped duplicate email (${quotation.email}) — already sent in this run`);
          continue;
        }

        if (emailKey && await hasRetargetingEmailSentForQuotationEmail(quotation.email, quotation._id)) {
          await suppressQuotationRetargetingAsDuplicate(quotation);
          processedEmails.add(emailKey);
          duplicateEmailsSkipped += 1;
          console.log(`   ⏭️  Skipped duplicate email (${quotation.email}) — already sent via another quotation`);
          continue;
        }

        console.log(`\n📝 Processing quotation ID: ${quotation._id}`);
        console.log(`   Email: ${quotation.email}`);
        console.log(`   Name: ${quotation.Name}`);
        console.log(`   Reason: ${quotation.reason}`);

        // Calculate original total from estimatedPrices
        const originalTotal = calculateTotalFromEstimatedPrices(quotation.estimatedPrices);
        
        if (originalTotal === 0) {
          console.log(`   ⚠️  Skipping: No estimated prices found or total is 0`);
          continue;
        }

        console.log(`   Original Total: £${originalTotal.toFixed(2)}`);

        // Generate coupon codes
        const coupon20Code = await generateCouponCode('QUOTE20');
        const coupon10Code = await generateCouponCode('QUOTE10');

        console.log(`   Generated coupons: ${coupon20Code} (20%), ${coupon10Code} (10%)`);

        // Create expiration dates
        const now = new Date();
        const expiresAt20Percent = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // 24 hours
        const expiresAt10Percent = new Date(now.getTime() + (72 * 60 * 60 * 1000)); // 72 hours

        // Create coupon records
        const coupon20 = new Coupon({
          code: coupon20Code,
          percentage: 20,
          expirationDuration: 24,
          description: `Retargeting coupon for quotation ${quotation._id}`,
          expiresAt: expiresAt20Percent
        });
        await coupon20.save();

        const coupon10 = new Coupon({
          code: coupon10Code,
          percentage: 10,
          expirationDuration: 72,
          description: `Retargeting coupon for quotation ${quotation._id}`,
          expiresAt: expiresAt10Percent
        });
        await coupon10.save();

        // Calculate discounted totals
        let discountedTotal20 = originalTotal * 0.8; // 20% off
        let discountedTotal10 = originalTotal * 0.9; // 10% off

        // Apply minimum fee if needed
        let minFeeApplied20 = false;
        let minFeeApplied10 = false;

        if (discountedTotal20 < MINIMUM_TOTAL) {
          discountedTotal20 = MINIMUM_TOTAL;
          minFeeApplied20 = true;
        }

        if (discountedTotal10 < MINIMUM_TOTAL) {
          discountedTotal10 = MINIMUM_TOTAL;
          minFeeApplied10 = true;
        }

        // Convert quotation items to email format
        const items = convertQuotationItemsToEmailFormat(quotation);

        // Parse name
        const { firstName, lastName } = parseName(quotation.Name);

        // Generate order number (use quotation ID as reference)
        const orderNumber = `QUOTE${quotation._id.toString().substring(18)}`;

        // Send email
        console.log(`   📧 Sending retargeting email...`);
        await sendRetargetingEmail({
          customerEmail: quotation.email,
          firstName,
          lastName,
          orderNumber,
          coupon20Code,
          coupon10Code,
          discount20Percentage: 20,
          discount10Percentage: 10,
          items,
          originalTotal,
          discountedTotal20,
          discountedTotal10,
          minFeeApplied20,
          minFeeApplied10,
          expirationHours20: 24,
          expirationHours10: 72,
          expiresAt20: expiresAt20Percent,
          expiresAt10: expiresAt10Percent
        });

        // Update quotation record
        quotation.retargetingEmailSent = true;
        quotation.retargetingEmailSentAt = new Date();
        quotation.retargetingCoupon20Id = coupon20._id;
        quotation.retargetingCoupon10Id = coupon10._id;
        await quotation.save();

        if (emailKey) {
          processedEmails.add(emailKey);
        }

        console.log(`   ✅ Email sent successfully!`);
        successCount++;

      } catch (error) {
        console.error(`   ❌ Error processing quotation ${quotation._id}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Successfully sent: ${successCount}`);
    console.log(`   ⏭️  Duplicate emails skipped: ${duplicateEmailsSkipped}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📧 Total processed: ${quotations.length}`);

  } catch (error) {
    console.error('❌ Fatal error in script:', error);
    throw error;
  }
};

// Run the script
const run = async () => {
  try {
    await connectDB();
    await sendQuotationRetargetingEmails();
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
};

// Execute if run directly
if (require.main === module) {
  run();
}

module.exports = { sendQuotationRetargetingEmails };
