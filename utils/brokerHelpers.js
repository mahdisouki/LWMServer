function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pushActivity(doc, action, detail, actorName) {
  if (!doc.activityLog) doc.activityLog = [];
  doc.activityLog.unshift({
    action,
    detail: detail || '',
    actorName: actorName || '',
    createdAt: new Date(),
  });
  if (doc.activityLog.length > 50) {
    doc.activityLog = doc.activityLog.slice(0, 50);
  }
}

async function nextReferenceCode(Model, prefix, padLength = 4) {
  const year = new Date().getFullYear();
  const count = await Model.countDocuments({
    referenceCode: new RegExp(`^${prefix}-${year}-`),
  });
  let code;
  let attempts = 0;
  do {
    code = `${prefix}-${year}-${String(count + 1 + attempts).padStart(padLength, '0')}`;
    attempts += 1;
  } while (await Model.exists({ referenceCode: code }));
  return code;
}

module.exports = {
  escapeRegex,
  pushActivity,
  nextReferenceCode,
};
