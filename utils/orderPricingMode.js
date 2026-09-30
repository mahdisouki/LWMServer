function isEnabledFlag(value) {
  return value === true || value === 'true';
}

/** Admin-created orders, and public orders an admin has unlocked for editing. */
function usesAdminPricing(source = {}) {
  return source.createdByType === 'Admin' || isEnabledFlag(source.adminEditingEnabled);
}

/** Website pricing rules: public origin that has not been unlocked for admin editing. */
function usesPublicAutomaticPricing(source = {}) {
  return source.createdByType === 'public' && !isEnabledFlag(source.adminEditingEnabled);
}

module.exports = {
  usesAdminPricing,
  usesPublicAutomaticPricing,
};
