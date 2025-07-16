# Minimum Price Logic Implementation

This document explains the minimum price logic implemented across the London Waste Management system to ensure that any order under £30 (before VAT) is automatically adjusted to £30 + £6 VAT = £36 total.

## Overview

The system enforces a minimum order value of £30 (excluding VAT) for all tasks. If the calculated subtotal is less than £30, it is automatically adjusted to £30, and then VAT (20%) is applied, resulting in a final total of £36.

## Implementation Details

### 1. Constants

```javascript
const VAT_RATE = 0.2; // 20% VAT
const MINIMUM_PRICE = 36; // Minimum price including VAT (£30 + £6 VAT)
```

### 2. Logic Flow

The minimum price logic is applied in the following order:

1. **Calculate base price** from items and quantities
2. **Add position fees** (Inside: £6, InsideWithDismantling: £18)
3. **Apply discounts** (if any)
4. **Check minimum price** - if subtotal < £30, set to £30
5. **Add VAT** (20% of adjusted subtotal)
6. **Final total** = adjusted subtotal + VAT

### 3. Implementation Locations

#### A. Task Creation (`controllers/taskCtrl.js`)

```javascript
// In calculateTotalPrice function
// 4. Enforce minimum price (before VAT) - if under £30, make it £30
if (subtotal < 30) {
  subtotal = 30;
}

// 5. Add VAT (20%)
const vat = subtotal * 0.2;
const totalPrice = subtotal + vat;
```

#### B. Task Updates (`controllers/taskCtrl.js`)

```javascript
// In updateTask function
// Apply minimum price (before VAT) - if under £30, make it £30
if (finalPrice < 30) {
  finalPrice = 30;
}

const vat = finalPrice * 0.2;
finalPrice += vat;
```

#### C. Payment Processing (`services/paymentService.js`)

```javascript
// In calculateTotalPrice function
// Apply minimum price of £36 (including VAT) - if under £30 base price, make it £30 + £6 VAT
if (finalPrice < MINIMUM_PRICE) {
  // Calculate the adjustment needed to reach £36 total
  const adjustment = MINIMUM_PRICE - finalPrice;
  
  // Add minimum price adjustment to the breakdown
  breakdown.push({
    description: "Minimum price adjustment",
    amount: adjustment.toFixed(2),
  });
  
  finalPrice = MINIMUM_PRICE;
  basePrice = MINIMUM_PRICE / (1 + VAT_RATE); // This will be £30
}
```

#### D. Invoice Generation (`services/emailsService.js`)

```javascript
// In generateOfficialInvoicePDF function
// Apply minimum price (before VAT) - if under £30, make it £30
if (subtotal < 30) {
  subtotal = 30;
}

vat = subtotal * 0.2;
total = subtotal + vat;
```

#### E. Payment Links Generation (`controllers/taskCtrl.js`)

```javascript
// In generatePaymentLinks function
// Enforce minimum price (before VAT)
if (subtotal < 30) {
  const adjustment = 30 - subtotal;
  subtotal = 30;
  breakdown.push({
    description: 'Minimum price adjustment',
    amount: adjustment,
  });
}
```

## Examples

### Example 1: Order Under £30

**Input:**
- Item: £15
- Position: Outside (no fee)
- Discount: None

**Calculation:**
1. Subtotal: £15
2. Check minimum: £15 < £30 → Set to £30
3. VAT: £30 × 0.2 = £6
4. **Total: £36**

### Example 2: Order Exactly £30

**Input:**
- Item: £30
- Position: Outside (no fee)
- Discount: None

**Calculation:**
1. Subtotal: £30
2. Check minimum: £30 ≥ £30 → Keep £30
3. VAT: £30 × 0.2 = £6
4. **Total: £36**

### Example 3: Order Over £30

**Input:**
- Item: £50
- Position: Outside (no fee)
- Discount: None

**Calculation:**
1. Subtotal: £50
2. Check minimum: £50 ≥ £30 → Keep £50
3. VAT: £50 × 0.2 = £10
4. **Total: £60**

### Example 4: Order Under £30 with Position Fee

**Input:**
- Item: £20
- Position: Inside (£6 fee)
- Discount: None

**Calculation:**
1. Subtotal: £20 + £6 = £26
2. Check minimum: £26 < £30 → Set to £30
3. VAT: £30 × 0.2 = £6
4. **Total: £36**

### Example 5: Order Under £30 with Discount

**Input:**
- Item: £40
- Position: Outside (no fee)
- Discount: 50%

**Calculation:**
1. Original subtotal: £40
2. After discount: £40 × 0.5 = £20
3. Check minimum: £20 < £30 → Set to £30
4. VAT: £30 × 0.2 = £6
5. **Total: £36**

## Testing

Run the test script to verify the logic:

```bash
node test-minimum-price.js
```

This will test various scenarios and confirm that:
- Prices under £30 are adjusted to £30
- VAT is calculated correctly (20% of adjusted subtotal)
- Final totals are correct
- Edge cases are handled properly

## Important Notes

### 1. Order of Operations
The minimum price check is applied **after** discounts but **before** VAT calculation. This ensures that:
- Discounts are applied first
- Minimum price is enforced on the discounted amount
- VAT is calculated on the final subtotal

### 2. Position Fees
Position fees are included in the subtotal before the minimum price check:
- Inside: £6
- InsideWithDismantling: £18
- Outside: £0

### 3. Discounts
Both percentage and per-item discounts are applied before the minimum price check:
- Percentage discounts reduce the subtotal
- Per-item discounts modify individual item prices
- Minimum price is enforced on the final discounted subtotal

### 4. Invoice Display
In invoices and payment breakdowns, the minimum price adjustment is shown as a separate line item when applicable, making it transparent to customers.

### 5. Payment Processing
The minimum price logic is consistently applied across:
- Task creation
- Task updates
- Payment processing
- Invoice generation
- Payment link generation

## Error Handling

The system includes proper error handling for edge cases:
- Negative prices are prevented
- Zero prices are handled correctly
- Invalid discount percentages are validated
- Missing or invalid data is handled gracefully

## Future Considerations

1. **Configurable Minimum**: The minimum price could be made configurable via environment variables
2. **Currency Support**: The logic could be extended to support different currencies
3. **Dynamic VAT Rates**: VAT rates could be made configurable for different regions
4. **Minimum Price Exceptions**: Special cases could be added for certain customer types or services

## Monitoring

To monitor the minimum price logic:
1. Check logs for minimum price adjustments
2. Review invoice breakdowns for adjustment line items
3. Verify that all orders meet the minimum requirement
4. Monitor customer feedback regarding pricing transparency 