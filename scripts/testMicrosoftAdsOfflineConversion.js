/**
 * Test Microsoft Ads offline conversion upload (quote-to-purchase only).
 *
 * Usage:
 *   node scripts/testMicrosoftAdsOfflineConversion.js --dry-run --order ORD026853
 *   node scripts/testMicrosoftAdsOfflineConversion.js --upload --order ORD026853
 *   node scripts/testMicrosoftAdsOfflineConversion.js --upload --order ORD026853 --mark-exported
 *
 * Order must be Paid, have quotationId, and msclkid (task or quote).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const {
  getConversionName,
  uploadPurchaseConversionForTest,
  getAccessToken,
  resolveMsclkid,
} = require('../services/microsoftAdsConversionService');

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI missing in .env');
  }
  await mongoose.connect(uri);
}

function parseArgs(argv) {
  const args = {
    dryRun: argv.includes('--dry-run'),
    upload: argv.includes('--upload'),
    markExported: argv.includes('--mark-exported'),
    order: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--order' && argv[i + 1]) {
      args.order = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.dryRun && !args.upload) {
    console.error('Specify --dry-run or --upload');
    process.exit(1);
  }

  if (!args.order) {
    console.error('Specify --order ORD...');
    process.exit(1);
  }

  console.log('Offline conversion name:', getConversionName());
  console.log('Account ID:', process.env.MICROSOFT_ADS_ACCOUNT_ID);
  console.log('Customer ID:', process.env.MICROSOFT_ADS_CUSTOMER_ID);

  if (args.upload) {
    await getAccessToken();
    console.log('OAuth access token: OK');
  }

  await connectDB();

  try {
    const task = await Task.findOne({ orderNumber: args.order });
    if (!task) {
      throw new Error(`Task not found for order ${args.order}`);
    }

    if (!task.quotationId) {
      throw new Error(
        'Order has no quotationId — offline goal quote-to-purchase is only for quote-linked Paid orders',
      );
    }

    const msclkid = await resolveMsclkid(task);

    console.log('Task:', {
      orderNumber: task.orderNumber,
      paymentStatus: task.paymentStatus,
      quotationId: task.quotationId?.toString?.() || task.quotationId,
      msclkid: msclkid ? `${String(msclkid).slice(0, 16)}...` : null,
      totalPrice: task.totalPrice,
      microsoftAdsOfflineConversionExportedAt: task.microsoftAdsOfflineConversionExportedAt,
      microsoftAdsConversionError: task.microsoftAdsConversionError,
    });

    if (args.dryRun) {
      console.log('Dry run row preview:', {
        MicrosoftClickId: msclkid || '(missing — upload will skip)',
        ConversionName: getConversionName(),
        ConversionValue: task.totalPrice ?? 1,
        ConversionCurrencyCode: 'GBP',
      });
      return;
    }

    const result = await uploadPurchaseConversionForTest(task, {
      markExported: args.markExported,
    });
    console.log('Result:', JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
