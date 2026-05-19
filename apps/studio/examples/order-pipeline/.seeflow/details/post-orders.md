## POST /orders

Entry point for the order pipeline. Accepts a customer ID and list of line items, creates an order record, and publishes the `order.created` event to kick off downstream processing.

### Request
```json
{
  "customerId": "cust_123",
  "items": [{ "sku": "WIDGET-1", "qty": 2 }]
}
```

### Response
```json
{ "orderId": "ord_1234567890" }
```

### Emits
- `order.created` → Inventory Service