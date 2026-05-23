# Component Showcase — SeeFlow Example

Three `component`-type nodes that exercise the json-render-powered runtime end-to-end. Each node's UI is defined in `nodes/<id>/spec.json` (a catalog of Card / Heading / Metric / Button / Input / Select / Chart / Table / Markdown / … elements) and `flow.json` carries only the `type: "component"` tag.

## Run

```bash
seeflow start
```

SeeFlow seeds this example on first launch alongside `order-pipeline` and `ecommerce-platform`. Open the studio at `http://localhost:4321` and click the **Component Showcase** flow.

## What each node demonstrates

| Node       | Catalog elements                                | Action kind          | What to try                                                                                       |
| ---------- | ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| **Counter** | Card, Heading, Text, Metric, Button             | `set`                | Click **Set to 10** or **Reset** — the Metric flips immediately via a pure client-side state write. |
| **Random Stats** | Card, Heading, Label, Metric × 2, Progress × 2, Button, Markdown | `script`             | Click **Refresh** — the studio spawns `nodes/fetcher/actions/refresh.ts`, the script writes a JSON patch to stdout, and the runtime merges it into state. The Metric values, Progress bars, and Markdown notes all re-render with the new sample. |
| **Form Demo** | Card, Heading, Text, Label, Input, Select, Table, Button | `set` with `$param` | Type in the Name input or change the Tier select — each `onChange` dispatches a set action that reads the new value from the event payload (`{ "$param": "value" }`). |

## Patterns to learn from

- **`$state`** references in props (e.g. `{ "$state": "/count" }`) — resolved at render time.
- **`$action`** references on event handlers (e.g. `onClick: { "$action": "reset" }`) — resolved to a callable that dispatches by name.
- **`$param`** references inside a `set` action's `value` (e.g. `{ "$param": "value" }`) — pull a field out of the event payload at dispatch time.
- **Script actions** under `nodes/<id>/actions/<name>.ts` — JSON in via stdin, JSON out via stdout, keys are JSON Pointers that merge into state.

See `docs/plans/2026-05-23-component-node-design.md` for the full design rationale.
