function resolveCommissionAmount(broker, orderAmount, commissionAmount) {
  if (commissionAmount != null && commissionAmount !== '') {
    return Number(commissionAmount) || 0;
  }
  const amount = Number(orderAmount) || 0;
  if (!broker) return 0;
  if (broker.commissionType === 'Fixed') {
    return Number(broker.commissionValue) || 0;
  }
  return Math.round((amount * (Number(broker.commissionValue) || 0)) / 100);
}

function isCountableOrder(order) {
  return order && !['Cancelled', 'Draft'].includes(order.status);
}

module.exports = {
  resolveCommissionAmount,
  isCountableOrder,
};
