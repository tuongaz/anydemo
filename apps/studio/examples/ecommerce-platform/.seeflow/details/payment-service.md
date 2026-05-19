## Payment Service

Charges the customer and records the transaction.

### Triggered by
- `order.created`

### Steps
1. Retrieve saved payment method
2. Authorise charge via Stripe
3. Capture funds
4. Persist charge record

### Events Emitted
- `payment.captured` → Notification Service
- `payment.failed` → Notification Service