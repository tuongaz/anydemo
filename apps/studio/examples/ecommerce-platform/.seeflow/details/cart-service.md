## Cart Service

Per-user cart stored in Redis.

- `addItem(sku, qty)` — validates stock, adds line item
- `applyCoupon(code)` — validates and applies discount
- `checkout()` — freezes cart, emits `cart.checkout`

### Events Emitted
- `cart.checkout` → Order Service