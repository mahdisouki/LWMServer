/**
 * Find orders with no map coordinates, look each one up in Mapbox,
 * and write order number, address, postcode and location to CSV.
 *
 * Run: node scripts/exportJobsMissingLocation.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Task = require('../models/Task');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const MAPBOX_API_KEY = process.env.MAPBOX_API_KEY;
const OUT_PATH = path.join(__dirname, '..', 'jobs-missing-location.csv');

function hasCoordinates(location) {
  const coords = location && location.coordinates;
  return Array.isArray(coords)
    && coords.length >= 2
    && Number.isFinite(Number(coords[0]))
    && Number.isFinite(Number(coords[1]))
    && !(Number(coords[0]) === 0 && Number(coords[1]) === 0);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(address, postcode) {
  const query = [address, postcode, 'UK'].filter(Boolean).join(', ');
  if (!query.trim()) {
    return { location: '', error: 'no address or postcode' };
  }
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(MAPBOX_API_KEY)}&country=gb&limit=1&proximity=-0.12,51.5`;
  const response = await fetch(url);
  if (!response.ok) {
    return { location: '', error: `Mapbox HTTP ${response.status}` };
  }
  const data = await response.json();
  const center = data.features && data.features[0] && data.features[0].center;
  if (!Array.isArray(center) || center.length < 2) {
    return { location: '', error: 'no Mapbox result' };
  }
  const longitude = Number(center[0]);
  const latitude = Number(center[1]);
  return { location: `${longitude}, ${latitude}`, error: '' };
}

async function main() {
  if (!MONGO_URI) throw new Error('MONGO_URI is not set');
  if (!MAPBOX_API_KEY) throw new Error('MAPBOX_API_KEY is not set');

  await mongoose.connect(MONGO_URI);

  const missing = await Task.find({
    $or: [
      { location: { $exists: false } },
      { location: null },
      { 'location.coordinates': { $exists: false } },
      { 'location.coordinates': null },
      { 'location.coordinates': { $size: 0 } },
      { 'location.coordinates.0': { $exists: false } },
      { 'location.coordinates.1': { $exists: false } },
      { 'location.coordinates.0': 0, 'location.coordinates.1': 0 },
    ],
  })
    .select('orderNumber collectionAddress postcode location')
    .sort({ orderNumber: 1 })
    .lean();

  const rows = missing.filter((task) => !hasCoordinates(task.location));
  fs.writeFileSync(OUT_PATH, 'orderNumber,address,postcode,location,mapboxError\n', 'utf8');

  for (let index = 0; index < rows.length; index += 1) {
    const task = rows[index];
    const geocoded = await geocodeAddress(task.collectionAddress, task.postcode);
    const line = [
      csvCell(task.orderNumber),
      csvCell(task.collectionAddress),
      csvCell(task.postcode),
      csvCell(geocoded.location),
      csvCell(geocoded.error),
    ].join(',');
    fs.appendFileSync(OUT_PATH, `${line}\n`, 'utf8');
    if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
      console.log(`Geocoded ${index + 1} / ${rows.length}`);
    }
    await sleep(120);
  }

  console.log(`${rows.length} orders written to ${OUT_PATH}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
