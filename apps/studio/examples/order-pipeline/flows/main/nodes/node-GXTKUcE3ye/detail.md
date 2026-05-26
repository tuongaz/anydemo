## Inventory Service

Listens for `order.created` and attempts to reserve the requested stock in the warehouse. Checks available quantity, places a hold on the items, and records the warehouse location.

### Triggered by
- `order.created`

### Logic
1. Look up each SKU in the warehouse
2. Verify sufficient quantity is available
3. Place a reservation hold
4. Record the fulfilling warehouse ID

### Emits
- `stock.reserved` → Payment Service

### Payload
```json
{
  "reserved": true,
  "warehouseId": "wh_sydney"
}
```