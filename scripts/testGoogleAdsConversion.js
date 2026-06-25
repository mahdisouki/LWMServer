/**
 * Test Google Ads conversion uploads without recording (validateOnly) or with upload.
 *
 * Usage:
 *   node scripts/testGoogleAdsConversion.js --validate-only --order ORD042624
 *   node scripts/testGoogleAdsConversion.js --validate-only --quote 6a36af36c508a7c785b6aa09
 *   node scripts/testGoogleAdsConversion.js --upload --order ORD042624
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const QuotationRequest = require('../models/QuotationRequest');
const {
  isEnabled,
  getConversionTransport,
  validatePurchaseConversion,
  validateQuoteConversion,
  uploadPurchaseConversion,
  uploadQuoteConversion,
} = require('../services/googleAdsConversionService');

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }
  await mongoose.connect(uri);
}

function parseArgs(argv) {
  const args = {
    validateOnly: argv.includes('--validate-only'),
    upload: argv.includes('--upload'),
    order: null,
    quote: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--order' && argv[i + 1]) {
      args.order = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--quote' && argv[i + 1]) {
      args.quote = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.validateOnly && !args.upload) {
    console.error('Specify --validate-only or --upload');
    process.exit(1);
  }

  if (!args.order && !args.quote) {
    console.error('Specify --order ORD... or --quote <quotationId>');
    process.exit(1);
  }

  if (!isEnabled()) {
    console.error('GOOGLE_ADS_CONVERSIONS_ENABLED is not true');
    process.exit(1);
  }

  console.log('Conversion transport:', getConversionTransport());

  await connectDB();

  try {
    if (args.order) {
      const task = await Task.findOne({ orderNumber: args.order });
      if (!task) {
        throw new Error(`Task not found for order ${args.order}`);
      }

      console.log('Task:', {
        orderNumber: task.orderNumber,
        paymentStatus: task.paymentStatus,
        quotationId: task.quotationId?.toString?.() || task.quotationId,
        gclid: task.gclid ? `${task.gclid.slice(0, 20)}...` : null,
        gbraid: task.gbraid ? `${task.gbraid.slice(0, 20)}...` : null,
        googleAdsPurchaseConversionSentAt: task.googleAdsPurchaseConversionSentAt,
        googleAdsConversionError: task.googleAdsConversionError,
      });

      const fn = args.validateOnly ? validatePurchaseConversion : uploadPurchaseConversion;
      const result = await fn(task);
      console.log('Result:', JSON.stringify(result, null, 2));
      return;
    }

    const quote = await QuotationRequest.findById(args.quote);
    if (!quote) {
      throw new Error(`Quotation not found: ${args.quote}`);
    }

    console.log('Quotation:', {
      _id: quote._id.toString(),
      email: quote.email,
      gclid: quote.gclid ? `${quote.gclid.slice(0, 20)}...` : null,
      gbraid: quote.gbraid ? `${quote.gbraid.slice(0, 20)}...` : null,
      googleAdsQuoteConversionSentAt: quote.googleAdsQuoteConversionSentAt,
      googleAdsConversionError: quote.googleAdsConversionError,
    });

    const fn = args.validateOnly ? validateQuoteConversion : uploadQuoteConversion;
    const result = await fn(quote);
    console.log('Result:', JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
