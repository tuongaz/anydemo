# Worked example — checkout-flow plan

This is what Phase 5 emits to the user for a fresh "show how checkout works"
prompt against a hypothetical e-commerce project. Use it as a reference for
the level of detail (and brevity) the canonical plan format calls for.

The example assumes Phase 1 discovery (code-analyzer + system-analyzer) found:

- `src/checkout/api.ts` — Express handler for `POST /checkout`.
- `src/payments/stripe.ts` — Stripe charge integration (sync HTTP call).
- `src/orders/db.ts` — Postgres `orders` table (insert + status updates).
- `src/shipping/worker.ts` — BullMQ worker that consumes `order.created`
  and books a shipment via the Shippo API.

The node-planner produced four functional nodes (one per service / DB /
worker) and one decorative `user` icon. The play-designer placed a Play on the checkout endpoint
(sync API trigger), and the status-designer placed statuses on the orders
DB (row state) and the shipping worker (idle/busy).

---

```
## Plan for "show how checkout works"

Nodes (5)
  + user                [iconNode]    (decorative)
  + checkout-api        [playNode]    Play: POST /checkout (cart fixture)
  + payments-stripe     [stateNode]   (no play, no status — external SaaS black-box)
  + orders-db           [stateNode]   status: orders row state polling
  + shipping-worker     [stateNode]   status: worker idle / busy / processed-count

Connectors (5)
  + user             --default→ checkout-api          clicks checkout
  + checkout-api     --http →   payments-stripe       POST /v1/charges
  + checkout-api     --event→   shipping-worker       order.created
  + checkout-api     --http →   orders-db             INSERT orders
  + shipping-worker  --http →   orders-db             UPDATE status=shipped

Files to write:
  + .seeflow/checkout-flow/flow.json
  + .seeflow/checkout-flow/scripts/play-checkout.ts
  + .seeflow/checkout-flow/scripts/status-orders.ts
  + .seeflow/checkout-flow/scripts/status-shipping.ts
  + .seeflow/checkout-flow/state/.gitignore

Rationale: checkout-api is the sync trigger (Play sends a cart fixture to
/checkout via the running app on :3000). payments-stripe is a black-box
external SaaS — no Play, no status. orders-db gets row-state status (the
audience sees the order appear, transition to charged, then shipped).
shipping-worker is the async consumer — Play sits on checkout-api (the
source of the event chain), and status reports worker idle/busy +
processed count so the audience can see it pick up the job after they
click Play.

Reply 'go' to write, or describe what to change.
```

---

## What the rationale paragraph is for

It compresses the four sub-agents' reasoning into one human-readable
paragraph. Include:

- **Why the trigger is here**: e.g. "Play sits on checkout-api because the
  endpoint is the sync entry point — no fixture-producer needed."
- **Why these statuses**: e.g. "orders-db status shows the row appearing
  + transitioning; shipping-worker status shows the consumer picking up
  the job."
- **Why things were left out**: e.g. "payments-stripe is a black-box; we
  show the connector but don't try to poll Stripe directly."
- **Abstraction notes worth surfacing**: e.g. "shipping-worker is one
  node, not three — its three internal handlers are activities of the
  same worker."

Keep it ≤ 4 lines. Detail belongs in the agent prompts and the source
files, not the plan.

## What an edit-mode plan looks like

If the user re-runs the skill against the same project with prompt
"add refund handling to the checkout flow", the same plan template
becomes:

```
## Plan for "add refund handling to the checkout flow"

Nodes (7) — 2 new, 1 modified, 4 unchanged
  + refund-api          [playNode]    Play: POST /checkout/refund (refund fixture)
  + refunds-db          [stateNode]   status: refunds row state polling
  ~ orders-db           [stateNode]   status script now also reports refund linkage
  (4 unchanged: user, checkout-api, payments-stripe, shipping-worker)

Connectors (7) — 2 new, 5 unchanged
  + refund-api       --http→ payments-stripe       POST /v1/refunds
  + refund-api       --http→ refunds-db            INSERT refunds
  (5 unchanged)

Files to write:
  ~ .seeflow/checkout-flow/flow.json                          (4 new nodes/connectors)
  + .seeflow/checkout-flow/scripts/play-refund.ts             (new)
  + .seeflow/checkout-flow/scripts/status-refunds.ts          (new)
  ~ .seeflow/checkout-flow/scripts/status-orders.ts           (reports refund linkage)

Rationale: refund-api is a second sync endpoint, so it earns its own
Play (refunds are independent business meaning vs initial checkout).
refunds-db is one node (a single Postgres table), not split into
"insert" and "update" — abstraction rule for databases. Status on
orders-db is extended to surface the refund linkage column so the
audience can correlate the two flows visually.

Reply 'go' to write, or describe what to change.
```

The `+ / ~ / -` prefixes pull double duty: they tell the user what's
changing in this run AND let them spot accidental scope creep ("wait, I
didn't ask you to touch status-orders") before any files are written.
