function formatDuration(seconds) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  if (minutes === 0) {
    return `${secs} sec`;
  }
  return `${minutes}m ${secs}s`;
}

function percentChange(current, previous) {
  if (previous === 0 || previous == null) {
    return current > 0 ? null : 0;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

module.exports = {
  formatDuration,
  percentChange,
};
