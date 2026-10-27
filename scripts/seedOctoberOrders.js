/**
 * Create 40 orders for each of 27, 28 and 29 October 2026.
 * Addresses, postcodes and map locations are copied from older tasks.
 * Customer name, phone and email are placeholders so real customers are not reused.
 *
 * Run: node scripts/seedOctoberOrders.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const StandardItem = require('../models/StandardItem');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const SEED_NOTE = 'SEED_OCT_27_29_2026';
const DATES = ['2026-10-27', '2026-10-28', '2026-10-29'];
const PER_DAY = 40;
const SLOTS = ['AnyTime', '7am-12pm', '12pm-5pm'];

const FIRST_NAMES = [
  'James', 'Olivia', 'Noah', 'Amelia', 'George', 'Isla', 'Harry', 'Ava',
  'Jack', 'Mia', 'Leo', 'Sophia', 'Oscar', 'Grace', 'Arthur', 'Freya',
  'Charlie', 'Lily', 'Henry', 'Emily', 'Thomas', 'Chloe', 'William', 'Ella',
  'Alfie', 'Poppy', 'Freddie', 'Ivy', 'Theo', 'Daisy',
];
const LAST_NAMES = [
  'Walker', 'Hughes', 'Bennett', 'Clarke', 'Patel', 'Murphy', 'Cooper',
  'Ward', 'Brooks', 'Price', 'Collins', 'Reed', 'Bailey', 'Foster', 'Gray',
];

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hasCoordinates(location) {
  const coords = location && location.coordinates;
  return Array.isArray(coords)
    && coords.length >= 2
    && Number.isFinite(Number(coords[0]))
    && Number.isFinite(Number(coords[1]))
    && !(Number(coords[0]) === 0 && Number(coords[1]) === 0);
}

function locationFromSource(source) {
  if (!hasCoordinates(source.location)) return null;
  return {
    type: 'Point',
    coordinates: [Number(source.location.coordinates[0]), Number(source.location.coordinates[1])],
    address: source.location.address || source.collectionAddress,
  };
}

async function geocodeAddress(address, postcode) {
  const token = process.env.MAPBOX_API_KEY;
  if (!token) {
    throw new Error('MAPBOX_API_KEY is not set');
  }
  const query = [address, postcode].filter(Boolean).join(', ');
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(token)}&country=gb&limit=1&proximity=-0.12,51.5`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox geocode failed (${response.status}) for ${query}`);
  }
  const data = await response.json();
  const center = data.features && data.features[0] && data.features[0].center;
  if (!Array.isArray(center) || center.length < 2) {
    throw new Error(`No coordinates for ${query}`);
  }
  return {
    type: 'Point',
    coordinates: [Number(center[0]), Number(center[1])],
    address,
  };
}

const VAN_LOAD_OPTION_PERCENT = {
  '1/4 Load': 25,
  '1/2 Load': 50,
  '3/4 Load': 75,
  'Full Load / Large Load': 100,
};

async function calculateSpaceOfVanPercent(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let total = 0;
  for (const item of items) {
    const qty = Math.max(0, Number(item.quantity) || 1);
    if (item.standardItemId) {
      let space = Number(item.spaceOfVan);
      if (!Number.isFinite(space) || space <= 0) {
        const standardItem = await StandardItem.findById(item.standardItemId).select('spaceOfVan').lean();
        space = Number(standardItem?.spaceOfVan);
      }
      if (Number.isFinite(space) && space > 0) total += (qty / space) * 100;
    } else if (item.vanLoadOption && VAN_LOAD_OPTION_PERCENT[item.vanLoadOption] != null) {
      total += qty * VAN_LOAD_OPTION_PERCENT[item.vanLoadOption];
    }
  }
  const percent = Math.min(100, Math.round(total));
  // Custom-only items have no standard van size. Use a quarter load so the optimizer still counts them.
  return percent > 0 ? percent : 25;
}

function copyItems(items) {
  return (items || [])
    .filter((item) => item.standardItemId || (item.object && String(item.object).trim()))
    .map((item) => ({
      standardItemId: item.standardItemId || undefined,
      object: item.object || undefined,
      Objectsposition: item.Objectsposition || 'Outside',
      quantity: Number(item.quantity) || 1,
      price: item.price != null ? Number(item.price) : undefined,
      customPrice: item.customPrice != null ? Number(item.customPrice) : undefined,
      spaceOfVan: item.spaceOfVan != null ? Number(item.spaceOfVan) : undefined,
      timespentOutside: item.timespentOutside,
      timespentInside: item.timespentInside,
      timespentInsdiewithDis: item.timespentInsdiewithDis,
      vanLoadOption: item.vanLoadOption || undefined,
      ewcCode: item.ewcCode || undefined,
    }));
}

async function run() {
  if (!MONGO_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await Task.find({ privateNotes: SEED_NOTE })
    .select('orderNumber collectionAddress postcode location date')
    .lean();
  let filled = 0;
  for (const task of existing) {
    if (hasCoordinates(task.location)) continue;
    const location = await geocodeAddress(task.collectionAddress, task.postcode);
    await Task.updateOne({ _id: task._id }, { $set: { location } });
    filled += 1;
    console.log(`  ${task.orderNumber}  ${location.coordinates[0]}, ${location.coordinates[1]}`);
  }
  if (filled > 0) {
    console.log(`Filled coordinates on ${filled} orders.`);
  }

  const spaceTasks = await Task.find({ privateNotes: SEED_NOTE }).select('orderNumber items spaceOfVan');
  let spaceFilled = 0;
  for (const task of spaceTasks) {
    const percent = await calculateSpaceOfVanPercent(task.items);
    if (typeof task.spaceOfVan === 'number' && task.spaceOfVan === percent) continue;
    task.spaceOfVan = percent;
    await Task.updateOne({ _id: task._id }, { $set: { spaceOfVan: percent } });
    spaceFilled += 1;
    console.log(`  ${task.orderNumber}  spaceOfVan=${percent}`);
  }
  if (spaceFilled > 0) {
    console.log(`Set spaceOfVan on ${spaceFilled} orders.`);
  }

  const counts = {};
  for (const day of DATES) counts[day] = 0;
  const usedAddresses = new Set();
  for (const task of existing) {
    if (task.collectionAddress) usedAddresses.add(task.collectionAddress);
    const day = task.date ? new Date(task.date).toISOString().slice(0, 10) : '';
    if (counts[day] != null) counts[day] += 1;
  }
  const missing = DATES.reduce((sum, day) => sum + Math.max(0, PER_DAY - counts[day]), 0);
  if (missing === 0) {
    console.log(`Already have ${PER_DAY} orders on each day.`);
    await mongoose.disconnect();
    return;
  }

  const sources = await Task.find({
    collectionAddress: { $exists: true, $nin: ['', null] },
    postcode: { $exists: true, $nin: ['', null] },
    'items.0': { $exists: true },
    privateNotes: { $ne: SEED_NOTE },
    totalPrice: { $gt: 0 },
  })
    .select(
      'collectionAddress billingAddress postcode location items totalPrice taskDuration spaceOfVan available'
    )
    .lean();

  if (sources.length === 0) {
    console.error('No older tasks with an address and items were found.');
    process.exit(1);
  }

  const pool = shuffle(sources.filter((source) => !usedAddresses.has(source.collectionAddress)));
  if (pool.length === 0) {
    console.error('No unused older addresses left to copy.');
    process.exit(1);
  }
  let created = 0;
  let index = existing.length;
  let cursor = 0;

  for (const day of DATES) {
    const need = PER_DAY - counts[day];
    for (let n = 0; n < need; n += 1) {
      let source = null;
      let items = [];
      const start = cursor;
      do {
        source = pool[cursor % pool.length];
        cursor += 1;
        items = copyItems(source.items);
        if (cursor - start > pool.length) {
          throw new Error(`No usable address left for ${day}`);
        }
      } while (items.length === 0 || usedAddresses.has(source.collectionAddress));

      usedAddresses.add(source.collectionAddress);
      const slotIndex = counts[day] + n;
      const task = new Task({
        firstName: FIRST_NAMES[index % FIRST_NAMES.length],
        lastName: LAST_NAMES[index % LAST_NAMES.length],
        phoneNumber: `0700000${String(1000 + index).slice(-4)}`,
        email: '',
        collectionAddress: source.collectionAddress,
        billingAddress: source.billingAddress || source.collectionAddress,
        postcode: source.postcode,
        location: locationFromSource(source) || await geocodeAddress(source.collectionAddress, source.postcode),
        items,
        totalPrice: Number(source.totalPrice) || 0,
        taskDuration: source.taskDuration,
        spaceOfVan: await calculateSpaceOfVanPercent(items),
        date: new Date(`${day}T00:00:00.000Z`),
        available: SLOTS[slotIndex % SLOTS.length],
        createdBy: 'seed-script',
        createdByType: 'Admin',
        paymentStatus: 'Unpaid',
        paymentMethod: 'cash',
        taskStatus: 'New',
        privateNotes: SEED_NOTE,
      });

      await task.save();
      created += 1;
      console.log(`  ${task.orderNumber}  ${day}  ${task.available}  ${task.postcode}  ${task.location.coordinates.join(', ')}`);
      index += 1;
    }
  }

  console.log(`Done. Created ${created} orders.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
