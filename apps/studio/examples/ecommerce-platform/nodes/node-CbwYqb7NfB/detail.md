## API Gateway

Central ingress for every client.

- JWT validation before forwarding
- Token-bucket rate limiting per user and IP
- Path-based routing to downstream services
- OpenTelemetry spans for every request

### Routes
- `POST /auth/*` → Auth Service
- `GET /products/*` → Product Catalog
- `POST /cart/*` → Cart Service
- `POST /orders` → Order Service