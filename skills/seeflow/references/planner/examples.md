# `seeflow-node-planner` — worked examples

Illustrative material for the planner. The orchestrator forwards this
file's contents in the Phase 2 launching prompt on first calls and
skips it on retries (where the planner already has the issues echoed
back).

Used as calibration for the rules in `agents/seeflow-node-planner.md`
(§"Node abstraction rules", §"Resource nodes are mandatory"). Nothing
here introduces new constraints — it shows the rules applied.

## Examples of the rule applied

- **A Temporal workflow with 4 activities, none independently meaningful
  to the audience.** → 1 node,
  `rationales["temporal-workflow"]: "Single Temporal workflow — activities
  are implementation detail"`. Even though there are 4 activities, the
  audience cares about "did the workflow run?"; they don't need each
  activity surfaced.
- **A 4-stage pipeline (`validate → score → rank → publish`) inside one
  Temporal workflow, each stage independently meaningful.** → 4 nodes,
  connected by 3 connectors. Cite exception 1 in each rationale.
- **A `order.created` event with 3 distinct consumers (notify-customer,
  update-inventory, trigger-shipping).** → 4 nodes total: 1 publisher,
  1 event bus, 3 consumers — and one event connector from publisher to
  bus plus three event connectors from bus to each consumer. Cite
  exception 2.
- **A payments service exposing `charge`, `refund`, and `subscription`
  with independent state machines.** → 3 `rectangle` nodes
  (`payments-charge`, `payments-refund`, `payments-subscription`),
  each a candidate trigger (one of them carries the initial
  `playAction` placeholder) and each with its own status probe later.
  Cite exception 4.
  Contrast with a payments service whose `charge` and `refund` routes
  both mutate the same ledger row — that stays one node.
  - Variant: if the brief did not mention an explicit bus
    abstraction, you may omit the bus and connect publisher directly
    to each consumer with three event connectors. Use your judgement;
    err toward 4 nodes when the codebase has a named bus.
- **A microservice with 12 internal HTTP routes.** → 1 node, regardless
  of how many routes there are. The play-designer picks ONE route to
  hang the Play on; the other routes are not part of the demo.
- **A Postgres database used by 3 different services.** → 1 node, with
  3 connectors pointing into it. NOT 3 database nodes.

## Worked example

**Input** (paraphrased from the launching prompt):

```
contextBrief:
{
  "userIntent": "Show the end-to-end flow of an order moving through the pipeline from HTTP creation to payment, inventory confirmation, and shipping.",
  "audienceFraming": "Engineer-and-business audience, walkthrough depth — needs to see the HTTP entry, the event bus + queue fan-out, and the workers that drive state transitions.",
  "scope": {
    "rootEntities": [
      "order HTTP server",
      "event bus",
      "shipments queue",
      "inventory-worker",
      "shipping-worker",
      "order store"
    ],
    "outOfScope": ["admin stats endpoint", "marketing site"]
  },
  "codePointers": [
    { "path": "src/server.ts", "why": "POST /orders and POST /payments/charge handlers" },
    { "path": "src/event-bus.ts", "why": "Defines order.created publish/subscribe surface" },
    { "path": "src/queue.ts", "why": "Shipments queue producer/consumer" },
    { "path": "src/workers.ts", "why": "inventory-worker and shipping-worker" },
    { "path": "src/store.ts", "why": "Order state mutations" }
  ],
  "existingDemo": null
}
editTarget: null
```

**Expected final message** (single fenced JSON block, nothing else):

```json
{
  "name": "Order Pipeline",
  "slug": "order-pipeline",
  "nodes": [
    { "id": "order-server",     "type": "rectangle", "data": { "name": "POST /orders",     "icon": "server", "stateSource": { "kind": "request" }, "playAction": { "kind": "script", "interpreter": "bun", "scriptPath": "scripts/play.ts" }, "description": "Accepts a cart, creates an order, publishes order.created.", "detail": "## POST /orders\n\nHTTP entry point for the pipeline. Accepts a cart payload, writes a pending row to the order store, and publishes `order.created` on the bus.\n\nSource: `src/server.ts`." } },
    { "id": "event-bus",        "type": "queue",     "data": { "name": "Event Bus",        "stateSource": { "kind": "event" },   "description": "Fans order.created to async consumers.",                    "detail": "## Event Bus\n\nIn-process pub/sub layer defined in `src/event-bus.ts`. Subscribers to `order.created`: inventory-worker, shipping-worker." } },
    { "id": "inventory-worker", "type": "rectangle", "data": { "name": "Inventory Worker", "icon": "cog",    "stateSource": { "kind": "event" },   "description": "Reserves stock when an order.created event arrives.",       "detail": "## Inventory Worker\n\nReserves stock when an `order.created` event arrives. On success enqueues the order on the shipments queue.\n\nSource: `src/workers.ts` (`inventoryWorker`)." } },
    { "id": "shipping-worker",  "type": "rectangle", "data": { "name": "Shipping Worker",  "icon": "cog",    "stateSource": { "kind": "event" },   "description": "Drains the shipments queue, moves orders to shipped.",      "detail": "## Shipping Worker\n\nDrains the shipments queue and transitions the order row to `shipped` in the order store.\n\nSource: `src/workers.ts` (`shippingWorker`)." } },
    { "id": "shipments-queue",  "type": "queue",     "data": { "name": "Shipments Queue",  "stateSource": { "kind": "event" },   "description": "Buffer between inventory confirmation and shipping handoff.","detail": "## Shipments Queue\n\nMessage queue (`src/queue.ts`) that buffers shipment handoffs between inventory confirmation and shipping. One channel; depth ≈ pending shipments." } },
    { "id": "order-store",      "type": "database",  "data": { "name": "Order Store",      "stateSource": { "kind": "event" },   "description": "Authoritative order state: pending → paid → shipped.",      "detail": "## Order Store\n\nAuthoritative order state — rows transition `pending → paid → shipped`. Written by order-server, inventory-worker, and shipping-worker.\n\nSource: `src/store.ts`." } }
  ],
  "connectors": [
    { "id": "c-order-server-event-bus",          "source": "order-server",     "target": "event-bus",        "label": "order.created" },
    { "id": "c-event-bus-inventory-worker",      "source": "event-bus",        "target": "inventory-worker", "label": "order.created" },
    { "id": "c-inventory-worker-shipments-queue","source": "inventory-worker", "target": "shipments-queue",  "label": "shipments" },
    { "id": "c-shipments-queue-shipping-worker", "source": "shipments-queue",  "target": "shipping-worker",  "label": "shipments" },
    { "id": "c-order-server-order-store",        "source": "order-server",     "target": "order-store" },
    { "id": "c-inventory-worker-order-store",    "source": "inventory-worker", "target": "order-store" },
    { "id": "c-shipping-worker-order-store",     "source": "shipping-worker",  "target": "order-store" }
  ],
  "rationales": {
    "order-server":     "Single HTTP service. Internal routes (orders, payments) are implementation detail.",
    "event-bus":        "Named bus abstraction in the codebase — one channel, not many.",
    "inventory-worker": "Exception 2: fan-out consumer whose work is its own business concept.",
    "shipping-worker":  "Exception 2: fan-out consumer whose work is its own business concept.",
    "shipments-queue":  "Single message queue — one channel.",
    "order-store":      "Single database dependency, regardless of how many tables it holds."
  }
}
```

## Counter-example (do not do this)

```json
{
  "name": "Order Pipeline",
  "slug": "order-pipeline",
  "nodes": [
    { "id": "validate-cart", "type": "rectangle", "data": { "name": "validate cart", "stateSource": { "kind": "event" } } },
    { "id": "compute-tax",   "type": "rectangle", "data": { "name": "compute tax",   "stateSource": { "kind": "event" } } },
    { "id": "charge-card",   "type": "rectangle", "data": { "name": "charge card",   "stateSource": { "kind": "event" } } },
    { "id": "publish-event", "type": "rectangle", "data": { "name": "publish event", "stateSource": { "kind": "event" } } }
  ],
  "connectors": [],
  "rationales": { "validate-cart": "step 1", "compute-tax": "step 2", "charge-card": "step 3", "publish-event": "step 4" }
}
```

This is wrong because (a) the four "steps" are internal routes / handlers
of a single service — they fail the abstraction rule (one node per
microservice), and "step 1/2/3/4" does NOT match any exception; (b) no
node carries an initial `data.playAction` placeholder, so the audience
has nothing to click; (c) there are zero connectors, so the
orchestrator cannot render the flow direction. Collapse to a single
`order-server` `type:'rectangle'` with `data.playAction` set, and wire
connectors to the downstream entities.
