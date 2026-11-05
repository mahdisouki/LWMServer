/**
 * UK address lookup via Mapbox Geocoding.
 * Used when a task is created without coordinates.
 */

function parseLocation(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

function hasCoordinates(location) {
  const coords = location && location.coordinates;
  return Array.isArray(coords)
    && coords.length >= 2
    && Number.isFinite(Number(coords[0]))
    && Number.isFinite(Number(coords[1]))
    && !(Number(coords[0]) === 0 && Number(coords[1]) === 0);
}

function toPoint(location, fallbackAddress) {
  return {
    type: 'Point',
    coordinates: [Number(location.coordinates[0]), Number(location.coordinates[1])],
    address: location.address || fallbackAddress || undefined,
  };
}

async function geocodeUkAddress(address, postcode) {
  const token = process.env.MAPBOX_API_KEY;
  const query = [address, postcode, 'UK'].filter(Boolean).join(', ');
  if (!token || !String(address || postcode || '').trim()) {
    return null;
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${encodeURIComponent(token)}&country=gb&limit=1&proximity=-0.12,51.5`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox HTTP ${response.status}`);
  }
  const data = await response.json();
  const center = data.features && data.features[0] && data.features[0].center;
  if (!Array.isArray(center) || center.length < 2) {
    return null;
  }

  return {
    type: 'Point',
    coordinates: [Number(center[0]), Number(center[1])],
    address: address || undefined,
  };
}

/**
 * Keep a location that already has coordinates.
 * Otherwise look up collection address + postcode in Mapbox.
 * Returns null when nothing can be resolved. Does not throw.
 */
async function resolveTaskLocation({ location, collectionAddress, postcode }) {
  const parsed = parseLocation(location);
  if (hasCoordinates(parsed)) {
    return toPoint(parsed, collectionAddress);
  }

  try {
    return await geocodeUkAddress(collectionAddress, postcode);
  } catch (error) {
    console.error('[MapboxGeocode] lookup failed', {
      postcode: postcode || '',
      message: error.message,
    });
    return null;
  }
}

module.exports = {
  hasCoordinates,
  geocodeUkAddress,
  resolveTaskLocation,
};
