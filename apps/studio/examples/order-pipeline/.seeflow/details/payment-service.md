## Payment Service

Listens for `stock.reserved` and charges the customer's card on file. Integrates with the payment gateway to authorise and capture funds for the order total.

### Triggered by
- `stock.reserved`

### Logic
1. Retrieve customer's saved payment method
2. Calculate order total (items + tax + shipping)
3. Authorise charge with payment gateway
4. Capture funds and record the charge ID

### Emits
- `payment.captured` → Fulfillment Service

### Payload
```json
{
  "chargeId": "ch_1234567890",
  "amount": 4999
}
```