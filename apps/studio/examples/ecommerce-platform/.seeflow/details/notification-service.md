## Notification Service

Delivers transactional messages.

### Channels
- **Email** — AWS SES with DKIM/DMARC
- **SMS** — Twilio for OTP and shipping alerts
- **Push** — Firebase Cloud Messaging

### Triggered by
- `payment.captured` — order confirmation
- `payment.failed` — retry prompt
- `order.cancelled` — refund notification