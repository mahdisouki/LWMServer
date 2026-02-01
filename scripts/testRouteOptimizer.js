/**
 * Test script for the route optimizer (assign-and-optimize and calculate-routes).
 * Usage:
 *   node scripts/testRouteOptimizer.js [date] [--calculate-only] [--include-routes]
 *
 * Examples:
 *   node scripts/testRouteOptimizer.js                    # today, assign + persist
 *   node scripts/testRouteOptimizer.js 2026-01-30          # specific date
 *   node scripts/testRouteOptimizer.js 2026-01-30 --calculate-only   # no persist, Mapbox routes only
 *   node scripts/testRouteOptimizer.js 2026-01-30 --include-routes   # assign + persist + return route segments
 *
 * Requires: .env with MONGODB_URI or MONGO_URI. For Mapbox: MAPBOX_API_KEY (pk.*).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const routeOptimizerCtrl = require('../controllers/routeOptimizerCtrl');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const connectDB = async () => {
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI or MONGODB_URI not set in .env');
    process.exit(1);
  }
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected\n');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

const run = async () => {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => !a.startsWith('--'));
  const calculateOnly = args.includes('--calculate-only');
  const includeRoutes = args.includes('--include-routes');

  const date = dateArg || new Date().toISOString().split('T')[0];
  console.log('📅 Date:', date);
  console.log('📌 Mode:', calculateOnly ? 'calculate-routes only (no persist)' : 'assign-and-optimize (persist)');
  if (includeRoutes && !calculateOnly) {
    console.log('📌 Include route segments in response: yes');
  }
  console.log('');

  let statusCode = 200;
  let responsePayload = null;

  const mockRes = {
    status(code) {
      statusCode = code;
      return mockRes;
    },
    json(payload) {
      responsePayload = payload;
      return mockRes;
    },
  };

  try {
    if (calculateOnly) {
      const mockReq = {
        body: {
          date,
          respectTimeSlots: true,
        },
      };
      await routeOptimizerCtrl.calculateRoutes(mockReq, mockRes);
    } else {
      const mockReq = {
        body: {
          date,
          respectTimeSlots: true,
          includeRouteSegments: includeRoutes,
        },
      };
      await routeOptimizerCtrl.assignAndOptimize(mockReq, mockRes);
    }

    console.log('📤 Status:', statusCode);
    console.log('📤 Response:');
    console.log(JSON.stringify(responsePayload, null, 2));

    if (responsePayload && responsePayload.summary) {
      console.log('\n📊 Summary:');
      console.log('  - Date:', responsePayload.summary.date);
      if (responsePayload.summary.assigned != null) {
        console.log('  - Assigned:', responsePayload.summary.assigned);
      }
      if (responsePayload.summary.trucksUsed != null) {
        console.log('  - Trucks used:', responsePayload.summary.trucksUsed);
      }
      if (responsePayload.summary.total_drivers != null) {
        console.log('  - Drivers with routes:', responsePayload.summary.total_drivers);
      }
      if (responsePayload.summary.total_distance_km != null) {
        console.log('  - Total distance (km):', responsePayload.summary.total_distance_km?.toFixed(2));
      }
      if (responsePayload.summary.total_time_min != null) {
        console.log('  - Total time (min):', responsePayload.summary.total_time_min?.toFixed(1));
      }
      if (responsePayload.api_calls_used != null) {
        console.log('  - Mapbox API calls:', responsePayload.api_calls_used);
      }
    }

    if (responsePayload?.assignedByTruck && Object.keys(responsePayload.assignedByTruck).length > 0) {
      console.log('\n🚛 Assigned by truck:');
      for (const [name, count] of Object.entries(responsePayload.assignedByTruck)) {
        console.log('  -', name, ':', count, 'tasks');
      }
    }

    if (statusCode >= 400) {
      console.error('\n❌ Request failed with status', statusCode);
      process.exit(1);
    }
    console.log('\n✅ Done.');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 MongoDB disconnected');
    process.exit(0);
  }
};

connectDB()
  .then(run)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
