const COST_CATEGORIES = [
  'Direct Operational Expenses',
  'IT',
  'Offshore Operations',
  'Insurances & Compliance Liabilities',
  'Taxes, Fines & Accounting',
  'Short-Term Debt & Credit Lines',
  'Personal, Transfers & Savings',
];

const COST_TYPES = ['Fixed', 'Variable'];

const FEE_FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Custom'];

const CATEGORY_META = {
  'Direct Operational Expenses': { color: '#2563eb', icon: 'truck' },
  IT: { color: '#7c3aed', icon: 'computer' },
  'Offshore Operations': { color: '#0891b2', icon: 'public' },
  'Insurances & Compliance Liabilities': { color: '#ca8a04', icon: 'shield' },
  'Taxes, Fines & Accounting': { color: '#dc2626', icon: 'receipt' },
  'Short-Term Debt & Credit Lines': { color: '#ea580c', icon: 'account_balance' },
  'Personal, Transfers & Savings': { color: '#16a34a', icon: 'savings' },
};

module.exports = {
  COST_CATEGORIES,
  COST_TYPES,
  FEE_FREQUENCIES,
  CATEGORY_META,
};
