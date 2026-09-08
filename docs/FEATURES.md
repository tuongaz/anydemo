# SeeFlow — Features

> The canonical feature list. It describes what ships **today** (`@tuongaz/seeflow` v0.7.0) and is the source of truth for README, website, and docs rewrites. Terminology follows [/CONTEXT.md](../CONTEXT.md). SeeFlow runs entirely on localhost — there is no hosted service.

**SeeFlow is the bridge between AI coding agents and the humans they work with — a shared canvas both sides read, write, and understand.**

Your AI sees JSON; you see pictures. A SeeFlow flow is both at once: a schema-validated JSON file an agent authors and reads, rendered as a diagram a human explores and edits. System and architecture understanding is the flagship use case.

---

## 1. The foundation: one artifact both sides speak

- **File-defined and schema-validated.** A flow is a JSON document (`flow.json`) checked against a single Zod schema on every write — an agent cannot produce a corrupt canvas, and a human always opens something valid.
- **Meaning separated from looks.** Semantics (names, descriptions, relationships, detail) live in `flow.json`; pixel styling lives in a `style.json` side-table. An agent reads and writes meaning without wading through visuals; a human restyles without touching meaning.
- **Long-form detail on every node.** Each node can carry Markdown detail (Mermaid blocks supported) plus attachments — images, HTML views, component specs — stored beside the flow under `nodes/<id>/`.
- **Projects group flows.** A `seeflow.json` manifest names a project's flows and its default; everything is addressable as `project/flow`.
- **Lives in your repo.** Flows are plain files: committed, diffed, and reviewed like code, under the `.seeflow/` convention in the host repository.
- **Self-describing format.** `seeflow schema` (introspection with `--jq` slicing), `seeflow validate`, and `seeflow ids` — plus HTTP and MCP equivalents — let an agent teach itself the format, validate before writing, and mint canonical ids instead of guessing.
- **A rich shared vocabulary.** 23 node types: 14 geometric shapes (rectangle, ellipse, sticky, text, database, server, user, queue, cloud, diamond, hexagon, triangle, parallelogram, document) plus images, icons, HTML views, interactive components, tables, groups, freehand ink, decorative lines, and `linkflow` jumps that navigate between flows.
- **Connectors that document, not pretend.** Labels, direction (forward/backward/both/none), curved or stepped paths, ER/UML endpoint shapes (arrow, one, many, optional-many, diamond, circle), and descriptive metadata (HTTP method, URL, event/queue names) that records what a relationship *is* without claiming to execute it.
- **Cloud-vendor icons.** Vendor-prefixed icon ids (`aws:lambda`, `gcp:cloud-run`, `azure:functions`, `iconify:…`) round-trip through the schema; unprefixed names resolve to Lucide. Icon packs install locally per vendor, with license acceptance where required (Azure).

## 2. AI → Human: the agent shows you

- **One prompt → a flow.** The `/seeflow` skill turns a natural-language request into a registered, validated flow: three sub-agents analyze your codebase, conversation, or a document, then build the flow entirely through CLI calls — never hand-written JSON — with the studio validating every write. Shipped as plugins for Claude Code and Cursor.
- **A full MCP server.** `seeflow-mcp` exposes 20 tools — list, read, create, register, and edit flows, nodes, and connectors — usable from **any MCP client** (e.g. Claude Code, Codex, Cursor, Windsurf).
- **The canvas appears in the conversation.** On MCP Apps hosts (Claude Desktop today), five tools render the canvas inline: the agent opens the flow it just built, focuses a specific node, or scaffolds a new project without you leaving the chat. One process, one install — the MCP server boots its own embedded studio.
- **Atomic bulk authoring.** Up to 100 nodes and 100 connectors land in a single all-or-nothing call (`flow:add-bulk` / `seeflow_add_bulk`) — no half-drawn diagrams.
- **Auto-layout.** ELK layout via CLI or HTTP (`flows:layout`) gives agents readable diagrams without fumbling pixel coordinates.
- **A pull request, explained before you read it.** `/seeflow pr review <link>` turns a PR into a small set of linked flows: what the change touches, what it did to each part, the order things happen in, and a short guided tour.
- **Read tools sized to the question.** Topology-only (`flows:graph`), one node with its detail (`nodes:get`), or the full flow — so an agent shows you exactly the slice that answers your question.

## 3. Human → AI: you show the agent

- **A full visual editor.** `seeflow start` serves the studio at `localhost:4321`: drag-to-create tables with per-line resizing, groups (⌘G, double-click to enter/exit), freehand ink and decorative lines, image upload, an icon picker with emoji and installable vendor packs, per-node fonts, colors, borders, and shadows, alignment guides and snapping.
- **Everything you draw is data the agent reads.** No screenshots, no "let me describe my diagram": the `/seeflow-lookup` skill and the read tools/CLI give any agent a cost-laddered view of what you drew — list → topology → node → full detail.
- **The canvas talks back.** On MCP Apps hosts, your structural edits (node added, renamed, deleted; connector added, removed) stream to the model as they happen, and your selection and viewport are shared quietly — the agent knows which node you're pointing at when you say "this one."
- **Component widgets for rich explanations.** Nodes can render interactive UI declared as a JSON spec — charts, tables, metrics, code blocks, markdown, buttons, inputs (24 primitives) with local set-state actions and a fullscreen view — when a paragraph isn't enough.
- **Files open where you work.** From the studio, a node's backing files open in your editor or reveal in the OS file manager.

## 4. Shared memory: understanding that persists

- **A registry, not a scratchpad.** Flows register once and every future session finds them (`flows:list`, `seeflow_list_flows`) — a new conversation starts from what previous ones built instead of from zero.
- **Cross-agent by design.** The artifact is neutral JSON behind standard surfaces (CLI, MCP), so a flow authored with Claude Code today is read and extended from Codex or Cursor tomorrow.
- **Instant sync.** Every write — CLI, MCP tool, another window — appears on open canvases as it happens (SSE), so human and agent are always looking at the same picture.
- **Skills that learn your repo.** `/seeflow` keeps per-repo LEARN notes and reads them on the next run, so flow quality compounds.
- **A picture you can take with you.** Download any flow from the canvas as a PDF or PNG — the rendered diagram drops straight into a doc, a ticket, or a review without anyone else needing SeeFlow.

---

## Surface reference

| Capability | CLI | MCP | Skills | Studio + Canvas |
|---|---|---|---|---|
| Create project / flow | ✓ | ✓ | ✓ | ✓ |
| Register existing flow | ✓ | ✓ | ✓ | ✓ |
| Author nodes + connectors (incl. bulk) | ✓ | ✓ | ✓ | ✓ |
| Read flow / topology / node | ✓ | ✓ | ✓ | ✓ |
| Validate + schema introspection + ids | ✓ | ✓ | via CLI | ✓ |
| Auto-layout (ELK) | ✓ | — | via CLI | ✓ |
| Icon packs (install / browse) | ✓ | — | — | ✓ |
| Canvas rendered inside the conversation | — | ✓ (MCP Apps) | — | — |
| Human edits / selection streamed to the model | — | ✓ (MCP Apps) | — | — |
| Instant sync of edits (SSE) | writes | writes | writes | ✓ |
| PDF / PNG download | — | — | — | ✓ |
| Pull-request review flows | — | — | ✓ | ✓ |

Compatibility, stated at honest strength: the MCP server works with **any MCP client** (e.g. Claude Code, Codex, Cursor, Windsurf); the **inline canvas** requires an MCP Apps host (Claude Desktop today); the **authoring skills** ship as plugins for Claude Code and Cursor.
