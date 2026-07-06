function isClarityEnabled() {
  if (process.env.CLARITY_ENABLED === 'false') {
    return false;
  }
  return Boolean(process.env.CLARITY_API_TOKEN);
}

function getClarityApiToken() {
  return process.env.CLARITY_API_TOKEN || '';
}

module.exports = {
  isClarityEnabled,
  getClarityApiToken,
};
