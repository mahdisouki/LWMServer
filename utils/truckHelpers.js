const Truck = require('../models/Truck');
const Van = require('../models/Van');

/**
 * Resolve truckName to a Truck. Uses Truck.name (unit name) first, then Van name/matricule.
 */
async function findTruckByTruckName(truckName) {
  if (!truckName || typeof truckName !== 'string') return null;
  const trimmed = truckName.trim();
  if (!trimmed) return null;
  let truck = await Truck.findOne({ name: trimmed });
  if (truck) return truck;
  const van = await Van.findOne({
    $or: [
      { name: trimmed },
      { matricule: trimmed },
    ],
  });
  if (!van) return null;
  return Truck.findOne({ vanId: van._id });
}

/** Display name for a truck (unit name: Truck.name, then vanId fallback) */
function truckDisplayName(truck) {
  if (!truck) return '';
  if (truck.name) return String(truck.name);
  if (truck.vanId) {
    const v = truck.vanId;
    return (v.name || v.matricule || v._id) + '';
  }
  return truck._id ? truck._id.toString() : '';
}

module.exports = { findTruckByTruckName, truckDisplayName };
