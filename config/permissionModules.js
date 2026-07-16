const PERMISSION_ACTIONS = ['View', 'Edit', 'Delete'];

const MODULES = [
  'Dashboard',
  'Staff',
  'Orders',
  'Business_Customers',
  'Driver_Tracking',
  'Payroll',
  'Chat',
  'Standard_Items',
  'Tipping',
  'Tipping_Places',
  'Storage',
  'Storage_Places',
  'Truck',
  'Vans',
  'Day_Off',
  'Busy_Days',
  'Emails',
  'Quotations',
  'Feedback',
  'Route_Management',
  'Incidents',
  'Fuel_Records',
  'PCN_Damages',
  'Expenses',
  'Additional_Item_Requests',
  'Service_Categories',
  'Blog',
  'Announcement',
  'Logs',
  'Analytics',
  'Website_Analytics',
  'SEO',
  'Coupons',
  'Blue_Sheets',
  'Network_Sessions',
  'Ticks',
];

function permissionField() {
  return { type: [String], enum: PERMISSION_ACTIONS, default: [] };
}

function buildPermissionsSchema() {
  const schema = {};
  for (const moduleName of MODULES) {
    schema[moduleName] = permissionField();
  }
  return schema;
}

function sanitizePermissions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const result = {};
  for (const moduleName of MODULES) {
    const actions = input[moduleName];
    if (!Array.isArray(actions)) {
      continue;
    }

    const validActions = [...new Set(actions.filter((action) => PERMISSION_ACTIONS.includes(action)))];
    if (validActions.length > 0) {
      result[moduleName] = validActions;
    }
  }

  return result;
}

module.exports = {
  MODULES,
  PERMISSION_ACTIONS,
  buildPermissionsSchema,
  sanitizePermissions,
};
