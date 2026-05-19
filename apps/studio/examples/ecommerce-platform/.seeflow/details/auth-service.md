## Auth Service

- Password login (bcrypt), OAuth2 (Google, Apple), magic-link
- Access token: 15-min TTL, RS256 signed
- Refresh token: 30-day TTL in Redis

### Events
- `auth.login` on success
- `auth.token_refreshed` on refresh