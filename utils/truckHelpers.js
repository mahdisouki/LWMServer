const Truck = require('../models/Truck');
const Van = require('../models/Van');
const { User } = require('../models/User');

/** Populate helperId via User (avoids Helper discriminator mismatch returning null). */
function populateHelperId(select) {
  const options = { path: 'helperId', model: 'User' };
  if (select) options.select = select;
  return options;
}

function populateExtraHelpersHelperId(select) {
  const options = { path: 'extraHelpers.helperId', model: 'User' };
  if (select) options.select = select;
  return options;
}

function applyTruckStaffPopulate(query, select) {
  if (select) {
    return query
      .populate('driverId', select)
      .populate(populateHelperId(select))
      .populate('extraDrivers.driverId', select)
      .populate(populateExtraHelpersHelperId(select));
  }
  return query
    .populate('driverId')
    .populate(populateHelperId())
    .populate('extraDrivers.driverId')
    .populate(populateExtraHelpersHelperId());
}

function isHelperUser(user) {
  if (!user) return false;
  if (user.roleType === 'Helper') return true;
  return Array.isArray(user.role) && user.role.includes('Helper');
}

async function assertValidHelperId(helperId) {
  if (!helperId) return null;
  const user = await User.findById(helperId);
  if (!user || !isHelperUser(user)) {
    const err = new Error('Invalid helper: user must have Helper role');
    err.status = 400;
    throw err;
  }
  return user;
}

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

module.exports = {
  findTruckByTruckName,
  truckDisplayName,
  populateHelperId,
  populateExtraHelpersHelperId,
  applyTruckStaffPopulate,
  isHelperUser,
  assertValidHelperId,
};
