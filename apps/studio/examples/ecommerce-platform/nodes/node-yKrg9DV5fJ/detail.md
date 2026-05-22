## Order Service

Owns the order record and drives the downstream pipeline.

### State Machine
```
pending → confirmed → processing → shipped → delivered
       ↘ cancelled
```

### Triggered by
- `cart.checkout` event

### Events Emitted
- `order.created` → Payment Service
- `order.cancelled` → Notification Service