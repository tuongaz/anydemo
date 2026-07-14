# Pivot: SeeFlow is a bridge between AI agents and humans

Status: accepted (2026-07-14)

SeeFlow began as "runnable architecture demos": diagrams wired to a running app that fired real requests and lit up as events came back. Commit `f05609d1` (2026-06-29) deleted that execution layer, and we have decided the product it leaves behind is the actual product: **a bridge between AI coding agents (Claude Code, Codex, Cursor, …) and humans — a shared, schema-validated JSON canvas both sides read, write, and understand**, with system/architecture understanding as the flagship use case. `docs/FEATURES.md` is the canonical feature list written against this positioning; `CONTEXT.md` holds the vocabulary.

## Consequences

- All prior marketing content is superseded, not reframed. Retired vocabulary: **"demo"** (the artifact is a *flow*), **"live/living"** (including the "The living truth" and "Code to live diagrams" taglines), and every **"actually run" / "fire a real request"** claim — these are now false in code. `FEATURES.md` Appendix B tracks the scrub.
- Compatibility claims are tiered to what code supports: any MCP client for the MCP server; MCP Apps hosts (Claude Desktop today) for the inline canvas; Claude Code + Cursor for the shipped skill plugins.
- Connector fields `method`/`url`/`eventName`/`queueName` and node `handlerModule` remain schema-only documentation/reserved fields, not behavior.

## Considered options

- **Keep "living" with an honest meaning** (agents keep flows current, so diagrams don't drift) — rejected: the word is tainted by the exec era; positioning leads with communication, not currency claims.
- **Stay narrow: "AI-generated architecture diagrams"** — rejected: describes the wedge, not the category; the bridge (bidirectional AI↔human communication over one artifact) is the point.
- **Go fully general: "shared-understanding canvas for anything"** — rejected: the authoring skills only analyze codebases/systems today; the claim would outrun the code.
