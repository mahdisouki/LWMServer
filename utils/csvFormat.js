function csvCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvRow(values) {
  return values.map(csvCell).join(',');
}

module.exports = { csvCell, buildCsvRow };
