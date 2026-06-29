# Core authoring rules

Three rules every flow must honour. Each is invariant — bend them and the flow either lies about the system, looks wrong, or refuses to render.

## Rule 1 — model the real system, not a guess

**Every node maps to an entity the analyzers actually found in the codebase (or the brief actually names).** Never invent topology to fill the canvas.

- If a `codePointers.why` or `rootEntity` points at a real service / store / queue, it earns a node.
- If you can't find the entry point or entity the user asked about, say so (`audienceFraming`) and keep `rootEntities` accurate to what you did find — don't fabricate a plausible-looking box.
- For `inputClass === "document"`, the document text IS the source of truth — render its sections, don't embellish them with system components that aren't described.

A flow with one honest gap is better than one that silently lies about the architecture.

## Rule 2 — one node per concept

**Collapse by default; split only when an explicit exception earns it.** A microservice with twelve internal routes is one node; a Postgres database with forty tables is one node; a Temporal workflow with four activities is one node. Internal routes, tables, middleware, and helper classes are implementation detail — they are not separate nodes.

The exceptions that DO earn multiple nodes (cite the exception number in `rationales[nodeId]`):

1. **Pipeline stages independently meaningful to the audience** (`validate → score → rank → publish`).
2. **Fan-out consumers, each its own business concept** (`order.created → notify + restock + ship`).
3. **Choices / branches the audience must understand** (`paid → fulfill` vs `failed → refund`).
4. **One service hosting N independent state machines** (a payments service with distinct `charge` / `refund` / `subscription` lifecycles).

Full rule text + worked examples: `../agents/seeflow-node-planner.md` §"Node abstraction rules" and `planner/examples.md`.

## Rule 3 — resources are mandatory

**Every database, queue, event bus, cache, file/object store, and external SaaS the brief touches gets its own node and a connector pointing to it.** Resources are where the audience can SEE state land — a service that writes to a DB without that DB having its own node is a broken canvas.

Do NOT skip a resource node because:

- "It's just a side effect" — side effects are exactly what the audience needs to see.
- "The service already has a node" — the service and its resource are two different things; both deserve a node.
- "It wasn't listed in `rootEntities`" — infer resources from service behaviour (the system-analyzer's `dataEntryPaths` and the code-analyzer's `codePointers` are the signal).
- "It's internal to the service" — internal HTTP routes are implementation detail; an external DB or queue the service calls is NOT internal.

The mandatory-resource table (which resources, when they must appear) lives in `../agents/seeflow-node-planner.md` §"Resource nodes are mandatory".
