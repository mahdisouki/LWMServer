#!/usr/bin/env node
/**
 * WooCommerce orders export -> LWM Task migration (merged script)
 *
 * Combines ITEM_MAP + historical CSV pricing + insertMany batching
 * with Order Date -> Task.date, Time Slot -> available, additionalNotes, live StandardItem lookup.
 *
 * Usage:
 *   node scripts/migrateWooOrders.js csvFiles/orders-2025-2026.csv --dry-run   # preview only
 *   node scripts/migrateWooOrders.js csvFiles/orders-2025-2026.csv             # insert into DB
 *
 * Woo order numbers are stored as ORD{wooNumber}MIG (e.g. ORD29442MIG).
 *
 * After a live import, run:
 *   node scripts/backfillRepeatCustomer.js
 *
 * To rename already-imported raw Woo numbers:
 *   node scripts/backfillMigratedOrderNumbers.js --dry-run
 *   node scripts/backfillMigratedOrderNumbers.js
 */

'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');
const EWC_CODES = require('../config/ewcCodes');
const { resolveIsBusinessEmail } = require('../utils/businessEmail');

const MIGRATION_EMAIL = 'soukimahdi@gmail.com';

const CONFIG = {
  mongoUri: process.env.MONGO_URI || process.env.MONGODB_URI,
  ordersCsvPath:
    process.argv[2] && !process.argv[2].startsWith('--')
      ? path.resolve(process.argv[2])
      : path.resolve(process.env.ORDERS_CSV || 'csvFiles/orders-2025-2026.csv'),
  dryRun: process.argv.includes('--dry-run') || process.argv.includes('--dry'),
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  reportPath:
    process.env.REPORT_PATH || path.resolve(__dirname, 'migration-report.json'),
  batchSize: Number(process.env.BATCH_SIZE) || 500,
};

// ------------------------------------------------------------------
// ITEM MAP: SKU + Item Name -> StandardItem / vanLoad / custom
// ------------------------------------------------------------------
const ITEM_MAP = [
  ['', 'BBQ - Large', { std: 'BBQ – Large' }],
  ['', 'Coffee Machine - Small', { std: 'Coffee Machine – Small' }],
  ['', 'Coffee Machine – Medium', { std: 'Coffee Machine – Medium' }],
  ['', 'Cross Trainer', { std: 'Cross Trainer' }],
  ['', 'DVD Players / Sky Box', { std: 'DVD Players / Sky Box' }],
  ['', 'Dining Table', { std: 'Dining Table' }],
  ['', 'Dressing Table', { std: 'Dressing Table' }],
  ['', 'Fan', { std: 'Fan' }],
  ['', 'Large BBQ', { std: 'BBQ – Large' }],
  ['', 'Large Office Desk', { std: 'Large Office Desk' }],
  ['', 'Mini Fridge', { std: 'Mini Fridge' }],
  ['', 'Office Chair', { std: 'Office Chair' }],
  ['', 'Office Printer', { std: 'Office Printer' }],
  ['', 'Printer Large', { std: 'Printer Large' }],
  ['', 'Printer Small', { std: 'Printer Small' }],
  ['', 'Radio', { std: 'Radio' }],
  ['', 'Sewing Machine', { std: 'Sewing Machine' }],
  ['', 'Small Wardrobe', { std: 'Small Wardrobe' }],
  ['', 'Suitcase', { std: 'Suitcase' }],
  ['', 'Wooden Pallet - Heavy', { std: 'Wooden Pallet – Heavy' }],
  ['', 'Wooden Pallet - Light', { std: 'Wooden Pallet – Light' }],
  ['', 'Wooden Pallets - Heavy', { std: 'Wooden Pallet – Heavy' }],
  ['', 'Wooden Pallets - Light', { std: 'Wooden Pallet – Light' }],
  ['app-clo-dry', 'Tumble Dryer', { std: 'Tumble Dryer' }],
  ['app-dis-was', 'Dishwasher', { std: 'Dishwasher' }],
  ['app-iro', 'Iron', { std: 'Iron' }],
  ['app-iro-boa', 'Ironing Board', { std: 'Ironing Board' }],
  ['app-ket', 'Kettle', { std: 'Kettle' }],
  ['app-mic', 'Microwave', { std: 'Microwave' }],
  ['app-ove-coo', 'Cooker / Oven', { std: 'Cooker / Oven' }],
  ['app-ove-coo-dou', 'Double Cooker / Oven', { std: 'Double Cooker / Oven' }],
  ['app-was-mac', 'Washing Machine', { std: 'Washing Machine Removal' }],
  ['bed-bas-dou', 'Double Bed Base (Divan)', { std: 'Double Bed Base (Divan)' }],
  ['bed-bas-kin', 'King / Queen Bed Base (Divan)', { std: 'King / Queen Bed Base (Divan)' }],
  ['bed-bas-sin', 'Single Bed Base (Divan)', { std: 'Single Bed Base (Divan)' }],
  ['bed-duv-pil-cov', 'Bedding', { std: 'Bedding' }],
  ['bed-fra-dou', 'Double Bed Frame', { std: 'Double Bed Frame' }],
  ['bed-fra-kin', 'King / Queen Bed Frame', { std: 'King / Queen Bed Frame' }],
  ['bed-fra-sin', 'Single Bed Frame', { std: 'Single Bed Frame' }],
  ['bike', 'Bike', { std: 'Bike' }],
  ['bin-1100', '1100 Litre Bin', { std: '1100 Litre Bin' }],
  ['bin-660', '660 Litre Bin', { std: '660 Litre Bin' }],
  ['bin-hou-whe', 'Household Wheelie Bin', { std: 'Household Wheelie Bin' }],
  ['bin-was-bag', 'General Waste Bags', { std: 'General Waste Bags' }],
  ['cha-din', 'Dining Chair', { std: 'Dining Chair' }],
  ['cha-gar', 'Garden Chair', { std: 'Garden Chair' }],
  ['con-bag', 'Construction Waste Bags', { std: 'Construction Waste Bag' }],
  ['con-bat-tub', 'Bathtub', { std: 'Bathtub' }],
  ['con-bri', 'Bricks', { std: 'Bricks' }],
  ['con-car', 'Carpet / Rug', { std: 'Carpet / Rug' }],
  ['con-con-sla', 'Concrete Slabs', { std: 'Concrete Slabs / Posts' }],
  ['con-con-sla', 'Concrete Slabs / Posts', { std: 'Concrete Slabs / Posts' }],
  ['con-doo-ext', 'External Door', { std: 'External Door' }],
  ['con-doo-int', 'Internal Wooden Door', { std: 'Internal Wooden Door' }],
  ['con-doo-int-fir', 'Internal Wooden Fire Door', { std: 'Internal Wooden Fire Door' }],
  ['con-flo', 'Flooring', { std: 'Flooring' }],
  ['con-ins', 'Insulation', { std: 'Insulation' }],
  ['con-mdf-boa', 'MDF Boards', { std: 'MDF Boards' }],
  ['con-pla-boa', 'Plasterboard', { std: 'Plasterboard' }],
  ['con-rad', 'Standard Radiator', { std: 'Standard Radiator' }],
  ['con-rad-sma', 'Small Radiator', { std: 'Small Radiator' }],
  ['con-sho-tra', 'Shower Tray', { std: 'Shower Tray' }],
  ['con-sin', 'Sink', { std: 'Sink' }],
  ['con-soi-bag', 'Soil (per rubble bag)', { std: 'Soil (per rubble bag)' }],
  ['con-til', 'Tiles', { std: 'Tiles' }],
  ['con-tim-pla', 'Timber Planks', { std: 'Timber Planks' }],
  ['con-toi', 'Toilet', { std: 'Toilet' }],
  ['con-und', 'Underlay', { std: 'Underlay' }],
  ['con-win', 'Window', { std: 'Window' }],
  ['cots', 'Cots', { std: 'Cot' }],
  ['cushions', 'Cushions', { std: 'Cushions or Pillows' }],
  ['ele-car-bat', 'Car Battery', { std: 'Car Battery' }],
  ['ele-com', 'Computer', { std: 'Computer' }],
  ['ele-key-mou', 'Keyboard and Mouse', { std: 'Keyboard and Mouse' }],
  ['ele-lap', 'Laptop', { std: 'Laptop' }],
  ['ele-mon', 'Monitor Screen', { std: 'Monitor Screen' }],
  ['ele-tv', 'TV', { std: 'TV' }],
  ['empty-flattened-cardboard-boxes', 'Empty flattened cardboard box', { std: 'Cardboard Box (empty and flattened)' }],
  ['exercise-bike', 'Exercise bike', { std: 'Exercise bike' }],
  ['filling-cabinet-small', 'Filling cabinet small', { std: 'Filing Cabinet (Small)' }],
  ['filling-cabinet-tall', 'Filling cabinet tall', { std: 'Filing Cabinet (Tall)' }],
  ['fri-ame', 'American (Double) Fridge', { std: 'American (Double) Fridge' }],
  ['fri-che', 'Chest Freezer', { std: 'Chest Freezer' }],
  ['fri-com', 'Commercial Fridge', { std: 'Commercial Fridge' }],
  ['fri-sma', 'Small Fridge', { std: 'Small Fridge' }],
  ['fri-sta', 'Standard Fridge Freezer', { std: 'Standard Fridge Freezer' }],
  ['fur-boo-she', 'Bookshelf *SMALL SIZE*', { std: 'Bookshelf *SMALL SIZE*' }],
  ['fur-boo-she-1', 'Bookshelf *LARGE SIZE*', { std: 'Bookshelf *LARGE SIZE*' }],
  ['fur-che-dra', 'Chest of Drawers', { std: 'Chest of Drawers' }],
  ['fur-cup-lar', 'Large Wardrobe', { std: 'Large Wardrobe' }],
  ['gar-bbq', 'BBQ', { std: 'BBQ – Small' }],
  ['gar-bbq', 'BBQ - Small', { std: 'BBQ – Small' }],
  ['gar-fen', 'Fence Panel', { std: 'Fence Panel' }],
  ['gar-lar-pot', 'Large Plant Pot', { std: 'Large Plant Pot' }],
  ['gar-lar-pot-soi-pla', 'Large Plant Pot (including plant and soil)', { std: 'Large Plant Pot (including plant and soil)' }],
  ['gar-law', 'Lawnmower', { std: 'Lawnmower' }],
  ['gar-par', 'Parasol', { std: 'Parasol' }],
  ['gar-sma-pot', 'Small Plant Pot', { std: 'Small Plant Pot' }],
  ['gar-was-bag', 'Garden Waste Bag', { std: 'Garden Waste Bag' }],
  ['haz-was-adh-sea', 'Adhesives and Sealants', { std: 'Adhesives and Sealants' }],
  ['haz-was-flu-bul', 'Fluorescent Tube', { std: 'Fluorescent Tube' }],
  ['haz-was-pai', 'Paint', { std: 'Paint' }],
  ['haz-was-pho-bat', 'Phone Shop Battery Collection', { std: 'Phone Shop Battery Collection' }],
  ['lamp', 'Lamp', { std: 'Lamp' }],
  ['loa-cus', 'Waste Removal', { custom: true }],
  ['loa-ful', 'Full Load / Large Load', { vanLoad: 'Full Load / Large Load' }],
  ['loa-hal', '1/2 Load', { vanLoad: '1/2 Load' }],
  ['loa-qua', '1/4 Load', { vanLoad: '1/4 Load' }],
  ['loa-sma', 'Small Load', { custom: true }],
  ['loa-thr-qua', '3/4 Load', { vanLoad: '3/4 Load' }],
  ['loa-wai-and', 'Wait and Load', { std: 'Wait and Load' }],
  ['mat-dou', 'Double Mattress', { std: 'Double Mattress' }],
  ['mat-emp', 'Emperor Mattress', { std: 'Emperor Mattress' }],
  ['mat-kin', 'King / Queen Mattress', { std: 'King / Queen Mattress' }],
  ['mat-sin', 'Single Mattress', { std: 'Single Mattress' }],
  ['mat-top', 'Mattress Topper', { std: 'Mattress Topper' }],
  ['mirror', 'Mirror', { std: 'Mirror' }],
  ['shower-screen', 'Shower screen', { std: 'Shower Screen' }],
  ['side-unit', 'Side unit', { std: 'Side Unit' }],
  ['sof-2se', '2 Seater Sofa', { std: '2 Seater Sofa' }],
  ['sof-3se', '3 Seater Sofa', { std: '3 Seater Sofa' }],
  ['sof-arm', 'Armchair', { std: 'Armchair' }],
  ['sof-bed', 'Sofa Bed', { std: 'Sofa Bed' }],
  ['sof-cor', 'Corner Sofa', { std: 'Corner Sofa' }],
  ['sof-cor-lar', 'Large Corner Sofa', { std: 'Large Corner Sofa' }],
  ['sof-foo-sto', 'Footstool', { std: 'Footstool' }],
  ['storage-heater', 'Storage heater', { std: 'Storage Heater' }],
  ['tab-bed-sid', 'Bedside Table', { std: 'Bedside Table' }],
  ['tab-cof', 'Coffee Table', { std: 'Coffee Table' }],
  ['tab-gar', 'Garden Table', { std: 'Garden Table' }],
  ['tab-off-des', 'Office Desk', { std: 'Office Desk' }],
  ['tab-poo-sno', 'Pool / Snooker Table', { std: 'Pool / Snooker Table' }],
  ['tab-tv', 'TV Stand', { std: 'TV Stand' }],
  ['toaster', 'Toaster', { std: 'Toaster' }],
  ['treadmill', 'Treadmill', { std: 'Treadmill' }],
  ['vaccums-hoovers', 'Vaccums/Hoovers', { std: 'Vaccums/Hoovers' }],
];

const ITEM_MAP_LOOKUP = new Map(
  ITEM_MAP.map(([sku, name, resolution]) => [`${norm(sku)}|||${norm(name)}`, resolution])
);

const STATUS_MAP = {
  Processing: { taskStatus: 'Not_Completed', paymentStatus: 'Paid' },
  Completed: { taskStatus: 'Completed', paymentStatus: 'Paid' },
  Refunded: { taskStatus: 'Cancelled', paymentStatus: 'refunded' },
  Cancelled: { taskStatus: 'Cancelled', paymentStatus: 'Unpaid' },
  Failed: { taskStatus: 'Cancelled', paymentStatus: 'Failed' },
  'On hold': { taskStatus: 'On_Hold', paymentStatus: 'Unpaid' },
  'Pending payment': { taskStatus: 'Processing', paymentStatus: 'Unpaid' },
  'Partial Paid': { taskStatus: 'Not_Completed', paymentStatus: 'partial_Paid' },
  Cash: { taskStatus: 'Completed', paymentStatus: 'Paid' },
  'Bank Transfer': { taskStatus: 'Completed', paymentStatus: 'Paid' },
  WTN: { taskStatus: 'Completed', paymentStatus: 'Paid' },
};
const DEFAULT_STATUS = { taskStatus: 'Not_Completed', paymentStatus: 'Unpaid' };

const EWC_CODE_SET = new Set(EWC_CODES);

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
function norm(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function toNumber(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function nonEmpty(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function buildAddress(addr1and2, city, state, postcode) {
  return [addr1and2, city, state, postcode]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ');
}

function parseOrderDate(dateStr) {
  if (!dateStr || !dateStr.trim()) return new Date();
  try {
    if (dateStr.includes(' ')) {
      const [datePart, timePart] = dateStr.split(' ');
      const [year, month, day] = datePart.split('-');
      const [hour, minute] = (timePart || '00:00').split(':');
      return new Date(year, month - 1, day, hour || 0, minute || 0);
    }
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

function mapAvailable(timeSlot) {
  if (!timeSlot || !timeSlot.trim()) return 'AnyTime';
  const slot = timeSlot.toLowerCase().trim();
  if (slot === 'asap') return 'AnyTime';
  if (slot.includes('07:00') || slot.includes('7am') || (slot.includes('12:00') && slot.includes('07'))) {
    return '7am-12pm';
  }
  if ((slot.includes('12:00') && slot.includes('17:00')) || (slot.includes('12:00') && slot.includes('5pm'))) {
    return '12pm-5pm';
  }
  if (slot.includes('morning') || slot.includes('before 12')) return '7am-12pm';
  if (slot.includes('afternoon') || slot.includes('after 12')) return '12pm-5pm';
  return 'AnyTime';
}

function mapPaymentMethod(title, orderStatus) {
  if (orderStatus === 'Partial Paid') return 'partial_payment';
  const t = norm(title);
  if (!t) return 'cash';
  if (t.includes('bank') || t.includes('transfer')) return 'BankTransfer';
  if (t.includes('link') || t.includes('payment_link')) return 'payment_link';
  if (t.includes('partial')) return 'partial_payment';
  if (
    t.includes('paypal') ||
    t.includes('visa') ||
    t.includes('mastercard') ||
    t.includes('amex') ||
    t.includes('card') ||
    t.includes('stripe')
  ) {
    return 'online';
  }
  if (t.includes('cash')) return 'cash';
  return 'online';
}

function safeEwcCode(code) {
  if (!code) return undefined;
  return EWC_CODE_SET.has(code) ? code : undefined;
}

/** Stored Task.orderNumber for Woo imports: ORD29442MIG */
function toMigratedOrderNumber(wooOrderNumber) {
  return `ORD${String(wooOrderNumber).trim()}MIG`;
}

function isMigratedOrderNumber(orderNumber) {
  return /^ORD\d+MIG$/i.test(String(orderNumber || '').trim());
}

function appendWooOrderRef(customerNote, wooOrderNumber) {
  const ref = `Woo order: ${wooOrderNumber}`;
  if (!customerNote) return ref;
  if (customerNote.includes(ref)) return customerNote;
  return `${customerNote}\n${ref}`;
}

function loadOrdersFromCsv(csvFilePath) {
  return new Promise((resolve, reject) => {
    const ordersMap = new Map();

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const orderNumber = (row['Order Number'] || '').toString().trim();
        if (!orderNumber) return;

        if (!ordersMap.has(orderNumber)) {
          const billingFirst = nonEmpty(row['First Name (Billing)'], row['First Name (Shipping)']);
          const billingLast = nonEmpty(row['Last Name (Billing)'], row['Last Name (Shipping)']);

          const billingAddrRaw = buildAddress(
            row['Address 1&2 (Billing)'],
            row['City (Billing)'],
            row['State Code (Billing)'],
            row['Postcode (Billing)']
          );
          const shippingAddrRaw = buildAddress(
            row['Address 1&2 (Shipping)'],
            row['City (Shipping)'],
            row['State Code (Shipping)'],
            row['Postcode (Shipping)']
          );

          ordersMap.set(orderNumber, {
            orderNumber,
            firstName: billingFirst || 'Unknown',
            lastName: billingLast || 'Unknown',
            phoneNumber: nonEmpty(row['Phone (Billing)']) || 'N/A',
            postcode: nonEmpty(row['Postcode (Billing)'], row['Postcode (Shipping)']) || 'N/A',
            email: nonEmpty(row['Email (Billing)']) || undefined,
            billingAddress: billingAddrRaw || shippingAddrRaw || undefined,
            collectionAddress: shippingAddrRaw || billingAddrRaw || undefined,
            bussinessName: nonEmpty(row['Company (Billing)']) || undefined,
            totalPrice: toNumber(row['Order Total Amount'], 0),
            refundAmount: toNumber(row['Order Refund Amount'], 0),
            date: parseOrderDate(row['Order Date']),
            timeSlot: row['Time Slot'] || '',
            orderStatus: row['Order Status'] || '',
            paymentMethodRaw: row['Payment Method Title'] || '',
            customerNote: nonEmpty(row['Customer Note']) || undefined,
            couponCode: nonEmpty(row['Coupon Code']) || undefined,
            items: [],
          });
        }

        const sku = (row['SKU'] || '').trim();
        const itemName = (row['Item Name'] || '').trim();
        if (!sku && !itemName) return;

        ordersMap.get(orderNumber).items.push({
          sku,
          itemName,
          quantity: Math.max(1, toNumber(row['Quantity (- Refund)'], 1)),
          unitPrice: toNumber(row['Item Cost'], 0),
        });
      })
      .on('end', () => resolve(Array.from(ordersMap.values())))
      .on('error', reject);
  });
}

async function loadStandardItemCatalog() {
  const rows = await StandardItem.find().select('itemName spaceOfVan ewcCode').lean();
  const byNormName = new Map();
  for (const doc of rows) {
    byNormName.set(norm(doc.itemName), {
      id: doc._id,
      spaceOfVan: doc.spaceOfVan,
      ewcCode: doc.ewcCode,
    });
  }
  return byNormName;
}

function resolveLineItem(row, stdByNormName, report, orderNumber) {
  const { sku, itemName, quantity, unitPrice } = row;
  const key = `${norm(sku)}|||${norm(itemName)}`;
  let resolution = ITEM_MAP_LOOKUP.get(key);

  if (!resolution) {
    resolution = { custom: true };
    report.itemsCustomFallback.push({
      orderNumber,
      sku,
      itemName,
      reason: 'no ITEM_MAP entry',
    });
  } else if (resolution.custom) {
    report.itemsCustomFallback.push({
      orderNumber,
      sku,
      itemName,
      reason: 'explicitly marked custom in ITEM_MAP',
    });
  }

  if (resolution.std) {
    const std = stdByNormName.get(norm(resolution.std));
    if (!std) {
      report.itemsCustomFallback.push({
        orderNumber,
        sku,
        itemName,
        reason: `std target "${resolution.std}" missing from DB`,
      });
      return {
        object: itemName || sku,
        quantity,
        customPrice: unitPrice,
        Objectsposition: 'Outside',
      };
    }

    report.itemsResolved += 1;
    return {
      standardItemId: std.id,
      quantity,
      price: unitPrice,
      spaceOfVan: std.spaceOfVan,
      ewcCode: safeEwcCode(std.ewcCode),
      Objectsposition: 'Outside',
    };
  }

  if (resolution.vanLoad) {
    report.itemsResolved += 1;
    return {
      object: itemName,
      vanLoadOption: resolution.vanLoad,
      quantity,
      customPrice: unitPrice,
      Objectsposition: 'Outside',
    };
  }

  return {
    object: itemName || sku || 'Unknown Item',
    quantity,
    customPrice: unitPrice,
    Objectsposition: 'Outside',
  };
}

function buildTaskDoc(order, items, importedAt) {
  const statusInfo = STATUS_MAP[order.orderStatus] || DEFAULT_STATUS;
  let paymentStatus = statusInfo.paymentStatus;

  if (order.refundAmount > 0) {
    paymentStatus =
      order.refundAmount >= order.totalPrice ? 'refunded' : 'partial_Refunded';
  }

  const csvEmail = order.email;
  const paidNet = round2(order.totalPrice - order.refundAmount);
  const now = importedAt || new Date();

  const doc = {
    orderNumber: toMigratedOrderNumber(order.orderNumber),
    firstName: order.firstName,
    lastName: order.lastName,
    bussinessName: order.bussinessName,
    phoneNumber: order.phoneNumber,
    billingAddress: order.billingAddress,
    collectionAddress: order.collectionAddress,
    postcode: order.postcode,
    email: MIGRATION_EMAIL,
    isBusinessEmail: resolveIsBusinessEmail(MIGRATION_EMAIL, false),
    privateNotes: csvEmail ? `Original Woo email: ${csvEmail}` : undefined,
    totalPrice: order.totalPrice,
    items,
    clientObjectPhotos: [],
    date: order.date,
    available: mapAvailable(order.timeSlot),
    additionalNotes: appendWooOrderRef(order.customerNote, order.orderNumber),
    taskStatus: statusInfo.taskStatus,
    paymentStatus,
    paymentMethod: mapPaymentMethod(order.paymentMethodRaw, order.orderStatus),
    couponCode: order.couponCode,
    createdByType: 'Admin',
    createdBy: 'MigrationScript',
    createdAt: now,
    updatedAt: now,
  };

  if (paymentStatus === 'Paid' || paymentStatus === 'partial_Paid') {
    doc.paidAmount = {
      amount: paidNet,
      status: 'Paid',
      method: doc.paymentMethod === 'BankTransfer' ? 'BankTransfer' : doc.paymentMethod === 'online' ? 'online' : 'cash',
    };
  }

  return doc;
}

async function validateTaskDoc(doc) {
  const task = new Task(doc);
  await task.validate();
}

// ------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------
async function main() {
  if (!CONFIG.mongoUri) {
    console.error('❌ MONGO_URI or MONGODB_URI is required in .env');
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.ordersCsvPath)) {
    console.error('❌ CSV not found:', CONFIG.ordersCsvPath);
    process.exit(1);
  }

  const report = {
    config: {
      ordersCsvPath: CONFIG.ordersCsvPath,
      dryRun: CONFIG.dryRun,
      batchSize: CONFIG.batchSize,
    },
    ordersParsed: 0,
    docsBuilt: 0,
    ordersWithNoItems: 0,
    itemsResolved: 0,
    itemsCustomFallback: [],
    duplicateOrderNumbers: [],
    validationErrors: [],
    warnings: [],
    insertedCount: 0,
    skippedDuplicates: 0,
    failedOrders: [],
  };

  mongoose.set('strictQuery', false);
  await mongoose.connect(CONFIG.mongoUri);
  console.log('✅ Connected to MongoDB');

  const stdByNormName = await loadStandardItemCatalog();
  console.log(`✅ Loaded ${stdByNormName.size} StandardItems from DB`);

  for (const [, , resolution] of ITEM_MAP) {
    if (resolution.std && !stdByNormName.has(norm(resolution.std))) {
      report.warnings.push(
        `ITEM_MAP target "${resolution.std}" not found in StandardItem DB`
      );
    }
  }

  const orders = await loadOrdersFromCsv(CONFIG.ordersCsvPath);
  report.ordersParsed = orders.length;
  console.log(`✅ Parsed ${orders.length} orders from CSV`);

  const existingOrderNumbers = new Set(
    (await Task.find({}, { orderNumber: 1 }).lean()).map((t) => String(t.orderNumber))
  );

  const docs = [];
  const importedAt = new Date();

  for (const order of orders) {
    const storedOrderNumber = toMigratedOrderNumber(order.orderNumber);
    if (
      existingOrderNumbers.has(storedOrderNumber) ||
      existingOrderNumbers.has(order.orderNumber)
    ) {
      report.duplicateOrderNumbers.push({
        wooOrderNumber: order.orderNumber,
        storedOrderNumber,
      });
      continue;
    }

    const items = order.items.map((row) =>
      resolveLineItem(row, stdByNormName, report, order.orderNumber)
    );

    if (items.length === 0) {
      report.ordersWithNoItems += 1;
      report.warnings.push(`Order ${order.orderNumber}: no line items`);
      continue;
    }

    if (!order.firstName || order.firstName === 'Unknown') {
      report.warnings.push(`Order ${order.orderNumber}: missing first name`);
    }
    if (!order.phoneNumber || order.phoneNumber === 'N/A') {
      report.warnings.push(`Order ${order.orderNumber}: missing phone number`);
    }
    if (!STATUS_MAP[order.orderStatus]) {
      report.warnings.push(
        `Order ${order.orderNumber}: unrecognized status "${order.orderStatus}"`
      );
    }

    const doc = buildTaskDoc(order, items, importedAt);
    docs.push(doc);
  }

  report.docsBuilt = docs.length;

  for (const doc of docs) {
    try {
      await validateTaskDoc(doc);
    } catch (err) {
      report.validationErrors.push({
        orderNumber: doc.orderNumber,
        error: err.message,
      });
    }
  }

  if (CONFIG.dryRun) {
    console.log(`\n🧪 DRY RUN — built ${docs.length} Task documents (not inserted)`);
  } else if (report.validationErrors.length > 0) {
    console.error(
      `\n❌ ${report.validationErrors.length} validation error(s). Fix before importing.`
    );
  } else {
    for (let i = 0; i < docs.length; i += CONFIG.batchSize) {
      const batch = docs.slice(i, i + CONFIG.batchSize);
      try {
        const result = await Task.insertMany(batch, { ordered: false });
        report.insertedCount += result.length;
        console.log(`Inserted batch ${Math.floor(i / CONFIG.batchSize) + 1}: ${result.length} docs`);
      } catch (err) {
        if (err.insertedDocs) {
          report.insertedCount += err.insertedDocs.length;
        }
        if (err.writeErrors) {
          for (const we of err.writeErrors) {
            report.failedOrders.push({
              orderNumber: batch[we.index]?.orderNumber,
              error: we.errmsg || String(we.err),
            });
          }
        } else {
          report.failedOrders.push({
            orderNumber: `BATCH_${i}`,
            error: err.message,
          });
        }
      }
    }
  }

  report.skippedDuplicates = report.duplicateOrderNumbers.length;
  fs.writeFileSync(CONFIG.reportPath, JSON.stringify(report, null, 2));

  console.log('\n----------------------------------------------------');
  console.log(`Orders parsed:              ${report.ordersParsed}`);
  console.log(`Docs built:                 ${report.docsBuilt}`);
  console.log(`Skipped (already in DB):    ${report.skippedDuplicates}`);
  console.log(`Orders with zero items:     ${report.ordersWithNoItems}`);
  console.log(`Line items resolved:        ${report.itemsResolved}`);
  console.log(`Custom fallback items:      ${report.itemsCustomFallback.length}`);
  console.log(`Validation errors:          ${report.validationErrors.length}`);
  console.log(`Warnings:                   ${report.warnings.length}`);
  if (!CONFIG.dryRun) {
    console.log(`Inserted:                   ${report.insertedCount}`);
    console.log(`Failed:                     ${report.failedOrders.length}`);
  }
  console.log(`Report:                     ${CONFIG.reportPath}`);
  console.log('----------------------------------------------------');

  if (CONFIG.dryRun) {
    console.log('\nRe-run without --dry-run to insert into MongoDB.');
  } else if (report.insertedCount > 0) {
    console.log('\nNext step: node scripts/backfillRepeatCustomer.js');
  }

  await mongoose.disconnect();
}

module.exports = {
  toMigratedOrderNumber,
  isMigratedOrderNumber,
  appendWooOrderRef,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
