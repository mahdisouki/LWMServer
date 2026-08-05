/** Orders created by CSV/Woo migration scripts — excluded from analytics. */
const EXCLUDED_CREATED_BY = ['MigrationScript'];

/** Spread into Task $match / countDocuments filters. */
const excludeMigratedOrdersFilter = {
  createdBy: { $nin: EXCLUDED_CREATED_BY },
};

module.exports = {
  EXCLUDED_CREATED_BY,
  excludeMigratedOrdersFilter,
};
