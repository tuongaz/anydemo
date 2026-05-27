# Core authoring rules

Three rules every flow must honour. Each is invariant — bend them and the flow either lies, looks wrong, or refuses to run.

## Rule 1 — no mocks, ever

**NEVER mock a service, fake a response, or simulate what a real service returns.**

Scripts have exactly two purposes:

1. **Trigger a real service** — call a real endpoint, drop a real file, publish a real event. Only invented content allowed is *input data* (fixture body, sample file); the service receiving it must be real.
2. **Read real resource state** — query a real DB, poll a real queue depth, call a real health endpoint. Never fabricate state.

If a required service is not running, **stop and ask the user**. A flow with one honest gap is better than one that silently lies.

## Rule 2 — see the bigger picture before inserting data

Before writing a play script that INSERTs into a DB, publishes to a queue, or writes to a store, check whether the system already has a natural data-entry path. Direct inserts bypass validation and the code paths the flow is meant to show.

Check these patterns first (ask the system-analyzer — `dataEntryPaths` in its `learnUpdates`):

| Pattern | What to look for | Use instead |
|---|---|---|
| **API endpoint** | REST/gRPC/GraphQL endpoint that accepts the data | Call it |
| **File-drop processor** | File watcher / S3-event listener | Drop a fixture file into the watched path |
| **Event/message producer** | Publisher service or CLI that writes to the queue | Trigger the producer |
| **Seed / fixture command** | `make seed`, `bun run seed`, ORM factory | Run the seed command |
| **Webhook receiver** | `/webhooks/stripe`, `/events/github` | POST a synthetic webhook body |
| **Admin / backoffice API** | Internal endpoint for creating records | Use it |
| **File-based import** | CSV/JSON/NDJSON import endpoint or CLI | Drop a fixture or call the import endpoint |

If no higher-level path exists, document the reason in `rationale` and resort to a direct INSERT/PUBLISH.

## Rule 3 — follow the project's existing approach for running scripts

Before picking an interpreter, **inspect how the project already invokes code** and mirror that. The project's existing approach is always the right first choice; the script you ship runs in the same toolchain the project already supports, with the same helpers and clients the project already maintains.

**Decision order — apply in this order every time:**

1. **Use the project's existing approach.** Look at Phase 1 evidence — `runtimeProfile` (`primaryLanguage`, `packageManager`, dev/test commands, `integrationTestCommand`, `setupPattern`), `codePointers`, integration tests, fixtures, seed scripts, `Makefile` targets, helper modules. Whatever interpreter the project already uses to run scripts of this kind (call the running app, seed data, drop a fixture, poll state), use the **same** interpreter, the **same** args, and the **same** helper modules / clients. Integration tests in particular are pre-existing examples of "how this app gets called" — copy their pattern.
2. **No existing approach?** Pick the option that lets the script reach the real service most directly with the smallest payload, using a runtime the project's host already has available. Prefer something present in `runtimeProfile.devCommand` / `testCommand` over introducing a new tool.
3. **Explain any deviation** in `rationale` whenever you do not match `runtimeProfile.primaryLanguage`. Reviewers should see the reason for the fallback at a glance.

The interpreter MUST be runnable on the project's host — never require a runtime the project does not already declare. Never invent a script convention the project doesn't already use.
