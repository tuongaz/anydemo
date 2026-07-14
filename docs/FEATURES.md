# SeeFlow — Features

> The canonical feature list. It describes what ships **today** (`@tuongaz/seeflow` v0.6.1 + cloud.seeflow.dev) and is the source of truth for README, website, and docs rewrites. Terminology follows [/CONTEXT.md](../CONTEXT.md). Tags: **[Local]** = open-source npm package, **[Cloud]** = cloud.seeflow.dev.

**SeeFlow is the bridge between AI coding agents and the humans they work with — a shared canvas both sides read, write, and understand.**

Agents speak JSON; humans speak pictures. A SeeFlow flow is both at once: a schema-validated JSON file an agent authors and reads, rendered as a diagram a human explores and edits. System and architecture understanding is the flagship use case.

---

## 1. The foundation: one artifact both sides speak **[Local]**

- **File-defined and schema-validated.** A flow is a JSON document (`flow.json`) checked against a single Zod schema on every write — an agent cannot produce a corrupt canvas, and a human always opens something valid.
- **Meaning separated from looks.** Semantics (names, descriptions, relationships, detail) live in `flow.json`; pixel styling lives in a `style.json` side-table. An agent reads and writes meaning without wading through visuals; a human restyles without touching meaning.
- **Long-form detail on every node.** Each node can carry Markdown detail (Mermaid blocks supported) plus attachments — images, HTML views, component specs — stored beside the flow under `nodes/<id>/`.
- **Projects group flows.** A `seeflow.json` manifest names a project's flows and its default; everything is addressable as `project/flow`.
- **Lives in your repo.** Flows are plain files: committed, diffed, and reviewed like code, under the `.seeflow/` convention in the host repository.
- **Self-describing format.** `seeflow schema` (introspection with `--jq` slicing), `seeflow validate`, and `seeflow ids` — plus HTTP and MCP equivalents — let an agent teach itself the format, validate before writing, and mint canonical ids instead of guessing.
- **A rich shared vocabulary.** 23 node types: 14 geometric shapes (rectangle, ellipse, sticky, text, database, server, user, queue, cloud, diamond, hexagon, triangle, parallelogram, document) plus images, icons, HTML views, interactive components, tables, groups, freehand ink, decorative lines, and `linkflow` jumps that navigate between flows.
- **Connectors that document, not pretend.** Labels, direction (forward/backward/both/none), curved or stepped paths, ER/UML endpoint shapes (arrow, one, many, optional-many, diamond, circle), and descriptive metadata (HTTP method, URL, event/queue names) that records what a relationship *is* without claiming to execute it.
- **Cloud-vendor icons.** Vendor-prefixed icon ids (`aws:lambda`, `gcp:cloud-run`, `azure:functions`, `iconify:…`) round-trip through the schema; unprefixed names resolve to Lucide. Icon packs install locally per vendor, with license acceptance where required (Azure).

## 2. AI → Human: the agent shows you **[Local]**

- **One prompt → a flow.** The `/seeflow` skill turns a natural-language request into a registered, validated flow: three sub-agents analyze your codebase, conversation, or a document, then build the flow entirely through CLI calls — never hand-written JSON — with the studio validating every write. Shipped as plugins for Claude Code and Cursor.
- **A full MCP server.** `seeflow-mcp` exposes 20 tools — list, read, create, register, and edit flows, nodes, and connectors — usable from **any MCP client** (e.g. Claude Code, Codex, Cursor, Windsurf).
- **The canvas appears in the conversation.** On MCP Apps hosts (Claude Desktop today), five tools render the canvas inline: the agent opens the flow it just built, focuses a specific node, or scaffolds a new project without you leaving the chat. One process, one install — the MCP server boots its own embedded studio.
- **Atomic bulk authoring.** Up to 100 nodes and 100 connectors land in a single all-or-nothing call (`flow:add-bulk` / `seeflow_add_bulk`) — no half-drawn diagrams.
- **Auto-layout.** ELK layout via CLI or HTTP (`flows:layout`) gives agents readable diagrams without fumbling pixel coordinates.
- **Read tools sized to the question.** Topology-only (`flows:graph`), one node with its detail (`nodes:get`), or the full flow — so an agent shows you exactly the slice that answers your question.

## 3. Human → AI: you show the agent **[Local]**

- **A full visual editor.** `seeflow start` serves the studio at `localhost:4321`: drag-to-create tables with per-line resizing, groups (⌘G, double-click to enter/exit), freehand ink and decorative lines, image upload, an icon picker with emoji and installable vendor packs, per-node fonts, colors, borders, and shadows, alignment guides and snapping.
- **Everything you draw is data the agent reads.** No screenshots, no "let me describe my diagram": the `/seeflow-lookup` skill and the read tools/CLI give any agent a cost-laddered view of what you drew — list → topology → node → full detail.
- **The canvas talks back.** On MCP Apps hosts, your structural edits (node added, renamed, deleted; connector added, removed) stream to the model as they happen, and your selection and viewport are shared quietly — the agent knows which node you're pointing at when you say "this one."
- **Component widgets for rich explanations.** Nodes can render interactive UI declared as a JSON spec — charts, tables, metrics, code blocks, markdown, buttons, inputs (24 primitives) with local set-state actions and a fullscreen view — when a paragraph isn't enough.
- **Files open where you work.** From the studio, a node's backing files open in your editor or reveal in the OS file manager.

## 4. Shared memory: understanding that persists **[Local + Cloud]**

- **A registry, not a scratchpad.** Flows register once and every future session finds them (`flows:list`, `seeflow_list_flows`) — a new conversation starts from what previous ones built instead of from zero.
- **Cross-agent by design.** The artifact is neutral JSON behind standard surfaces (CLI, MCP), so a flow authored with Claude Code today is read and extended from Codex or Cursor tomorrow.
- **Instant sync.** Every write — CLI, MCP tool, another window — appears on open canvases as it happens (SSE), so human and agent are always looking at the same picture.
- **Skills that learn your repo.** `/seeflow` keeps per-repo LEARN notes and reads them on the next run, so flow quality compounds.

## 5. Human ↔ Human: share it onward **[Cloud]**

- **Publish from where you work.** `seeflow login` (browser sign-in from the CLI) then `seeflow export` — or "Export to seeflow.dev" on the canvas. First export creates a private project; re-export updates it in place.
- **Hosted viewer and dashboard.** cloud.seeflow.dev shows your projects and those shared with you; clean read-only viewers for projects and single flows.
- **Visibility you control.** `private` (default), `unlisted` (link-only), or `public` (listed in the public library at /flows). Private URLs are indistinguishable from missing ones — existence never leaks.
- **Invite by email.** Share a project with specific people as viewers (editor invites unlock with co-editing — see *Rolling out*).
- **Embed anywhere.** Theme-aware iframe embeds drop a read-only interactive canvas into docs, wikis, or blog posts; PDF and PNG downloads work in cloud and locally; shared links carry OpenGraph preview cards.
- **Authoring-only cloud.** The hosted studio never touches a host machine: process- and filesystem-executing endpoints are disabled by an exec guard.

---

## Surface reference

| Capability | CLI | MCP | Skills | Studio + Canvas | Cloud |
|---|---|---|---|---|---|
| Create project / flow | ✓ | ✓ | ✓ | ✓ | ✓ |
| Register existing flow | ✓ | ✓ | ✓ | ✓ | — |
| Author nodes + connectors (incl. bulk) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read flow / topology / node | ✓ | ✓ | ✓ | ✓ | ✓ |
| Validate + schema introspection + ids | ✓ | ✓ | via CLI | ✓ | ✓ |
| Auto-layout (ELK) | ✓ | — | via CLI | ✓ | ✓ |
| Icon packs (install / browse) | ✓ | — | — | ✓ | — |
| Canvas rendered inside the conversation | — | ✓ (MCP Apps) | — | — | — |
| Human edits / selection streamed to the model | — | ✓ (MCP Apps) | — | — | — |
| Instant sync of edits (SSE) | writes | writes | writes | ✓ | ✓ |
| PDF / PNG export, embed snippet | — | — | — | ✓ | ✓ |
| Publish to cloud | ✓ | — | — | ✓ | receives |
| Visibility, invites, library, embeds, link cards | — | — | — | — | ✓ |

Compatibility, stated at honest strength: the MCP server works with **any MCP client** (e.g. Claude Code, Codex, Cursor, Windsurf); the **inline canvas** requires an MCP Apps host (Claude Desktop today); the **authoring skills** ship as plugins for Claude Code and Cursor.

## Rolling out

Built but not yet user-visible — do not market as supported:

- **Co-editing.** The server side exists (per-flow sync over WebSocket, edit locks, presence); the share dialog still holds editor grants to read-only until launch.
- **Editor-role invites.** Present in the API and data model; become meaningful when co-editing ships.

## Appendix A — not features

Exists in code but must not appear in any feature claim:

- `handlerModule` on nodes — schema-only, reserved for a future skills runtime.
- `POST /api/diagram/propose-scope` and `POST /api/diagram/assemble` — orphaned endpoints from a removed pipeline; cleanup candidates.
- Exec-era artifacts still on disk in example projects (`.seeflow/flow-share/scripts/play-*.ts`, `status-*.ts`, `.seeflow/sdk/emit.ts`) — leftovers, not behavior.

## Appendix B — scrub list (stale claims to remove)

The execution layer ("play a flow", status badges, exec scripts) was removed in `f05609d1` (2026-06-29), and this document supersedes all prior positioning. The following still claim otherwise or use retired vocabulary ("demo", "live/living", "actually run"):

**seeflow (OSS repo)**

- `README.md` — tagline "Architecture diagrams that actually run…", lead paragraph ("live control panel wired directly to your running application… fire a real request…"), the "Why" bullets (Diagram drift / Onboarding friction / Demo tedium), the `--with-scripts` flag, the `script` action kind + `/actions/:name` docs, and the "23 tools (5 canvas + 18 JSON-only)" count (actual: 20 = 5 + 15).
- `apps/studio/package.json` — description "hosts file-defined demos … wired to a running app via REST + SSE"; keyword `playable`.
- `CLAUDE.md` — repeats the same "file-defined demos … wired to a running app" sentence.
- `apps/studio/src/mcp.ts` — error strings "unknown demo", "Failed to write demo file"; stale node-type counts in tool descriptions ("16 flat variants", "15 visual variants").
- `apps/studio/src/schema.ts` — comment "19 flat node types" (actual: 23).
- `skills/seeflow/SKILL.md` registered description — says "five sub-agents" (actual: three); `skills/seeflow/references/schema.md` still mentions `scriptPath`.
- `apps/web` — `demo-view.tsx` naming and "Unknown demo" UI strings.

**seeflow-cloud (proprietary repo)**

- `web/src/pages/home.tsx` — entire page copy predates this document: title "…actually run…", hero "Code to live diagrams…", footer "The living truth", "Zero to running demo", "Demo Tedium", MCP tools listed as `list_demos`/`get_demo`/`register_demo`.
- `web/src/lib/viewer-api.ts` — list endpoint still nests the flow in a `demo` field ("server-side rename is pending").
- `README.md`, CDK stack, `.env.example` — reference Cognito; auth is Clerk (the CDK Cognito UserPool is vestigial).
