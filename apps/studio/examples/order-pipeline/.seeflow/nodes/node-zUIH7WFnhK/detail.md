## Fulfillment Service

Listens for `payment.captured` and enqueues a shipment job for the warehouse to pick, pack, and dispatch the order. Assigns a tracking ID and notifies the customer.

### Triggered by
- `payment.captured`

### Logic
1. Convert the stock reservation into a pick list
2. Assign a carrier and service level
3. Generate a shipment ID and tracking number
4. Push the job to the warehouse queue
5. Send dispatch confirmation to the customer

### Payload
```json
{
  "shipmentId": "shp_1234567890",
  "orderId": "ord_1234567890"
}
```