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

/** Booking-hold / basket percentage offer — does not stack with Outside/AnyTime 10%. */
function isBasketPercentageDiscount(hasDiscount, discountType, customDiscountPercent) {
  return Boolean(
    hasDiscount &&
    discountType === 'percentage' &&
    Number(customDiscountPercent) > 0,
  );
}

module.exports = {
  usesAdminPricing,
  usesPublicAutomaticPricing,
  isBasketPercentageDiscount,
};
