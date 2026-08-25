# Component Showcase — SeeFlow Example

Three `component`-type nodes that exercise the json-render-powered runtime end-to-end. Each node's UI is defined in `nodes/<id>/spec.json` (a catalog of Card / Heading / Metric / Button / Input / Select / Chart / Tabs / Table / … elements) and `flow.json` carries only the `type: "component"` tag.

## Run

```bash
seeflow start
```

SeeFlow copies this example into `~/.seeflow/` and registers it on every studio start, alongside `order-pipeline` and `ecommerce-platform`. Open `http://localhost:4321` and click the **Component Showcase** flow.

## What each node demonstrates

| Node       | Catalog elements                                | Action kind          | What to try                                                                                       |
| ---------- | ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| **Counter** | Card, Heading, Text, Metric, Button             | `set`                | Click **Set to 10** or **Reset** — the Metric flips immediately via a pure client-side state write. |
| **Form Demo** | Card, Heading, Text, Label, Input, Select, Table, Button | `set` with `$param` | Type in the Name input or change the Tier select — each `onChange` dispatches a set action that reads the new value from the event payload (`{ "$param": "value" }`). |
| **Chart & Tabs** | Card, Heading, Text, Tabs, Metric, Chart | `set` with `$param` | Click between **Revenue / Users / Orders** — Tabs writes the active id to `/tab`, the Metric below reads it back via `$state`, and a recharts-lazy bar Chart renders three series across six months of static data. |

## Patterns to learn from

- **`$state`** references in props (e.g. `{ "$state": "/count" }`) — resolved at render time.
- **`$action`** references on event handlers (e.g. `onClick: { "$action": "reset" }`) — resolved to a callable that dispatches by name.
- **`$param`** references inside a `set` action's `value` (e.g. `{ "$param": "value" }`) — pull a field out of the event payload at dispatch time.
