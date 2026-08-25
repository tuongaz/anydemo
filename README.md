# SeeFlow

> Your AI sees JSON; you see pictures.

SeeFlow is a localhost studio for architecture diagrams that an AI coding agent and a human can both work on. A flow is a schema-validated JSON file the agent authors over the CLI or MCP; the studio renders it at `localhost:4321` as a React Flow canvas you explore, edit, and hand back. Nothing leaves your machine.

## Why

- **You can't review what you can't see.** Your agent already has a model of your system — a flow turns it into a picture you can check and correct.
- **What you draw is data the agent reads back.** No screenshots, no "let me describe my architecture": `/seeflow-lookup` hands any agent the same artifact, sliced to the question.
- **It lives in your repo.** Flows are plain JSON files — committed, diffed, and reviewed like code.

## Quick Start

The SeeFlow plugin reads your codebase, works out your architecture, and generates the whole diagram for you. Works with Claude Code, Codex, Cursor, and Windsurf.

### 1. Start the studio

```bash
npx -y @tuongaz/seeflow@latest start
# then open http://localhost:4321
```

Requires Bun ≥ 1.3 (or Node with npx). The studio scans `$(pwd)/flow.json` on start and auto-registers that flow if present. The studio's registry persists under `~/.seeflow/` across restarts.

<details>
<summary>Prefer Docker?</summary>

```bash
docker run --rm -it -p 4321:4321 -v $(pwd):/workspace tuongaz/seeflow
```

The image ships with a pre-registered **Order Pipeline** example so you can see the canvas immediately, and the studio scans `/workspace/flow.json` on start.

</details>

### 2. Install the plugin

**Skill installer (recommended):**

```bash
npx skills add tuongaz/seeflow
```

**Then just ask:**

```
/seeflow show me the shopping cart feature
```

The plugin scans your routes and database connections, generates `flow.json`, and opens the canvas at localhost:4321.

### `/seeflow-lookup` — consult an existing flow

Once a flow is registered, agents can read it back as architectural ground truth:

```
/seeflow-lookup list                                    # catalog of registered flows
/seeflow-lookup flow <id>                               # nodes + connectors (no detail content)
/seeflow-lookup node <flowId> <nodeId>                  # single node with detail/html inlined
/seeflow-lookup flow <id> --full                        # everything inlined
```

Read-only. JSON output. Start cheapest (`list`) and drill in.

## Component nodes

The `component` node type turns a canvas node into a json-render-powered reactive UI driven by a small catalog of shadcn-styled primitives (Card, Button, Input, Chart, Markdown, etc.). The spec lives at `<project>/nodes/<id>/spec.json` — declaring an element tree, optional initial state, and a typed action vocabulary — while `flow.json` carries only the `type: 'component'` tag. Actions are `set` actions: they mutate the widget's local state via JSON Pointer paths, so the node stays interactive entirely in the browser.

## Icon packs

Cloud vendor icons (AWS, GCP, Azure) install on demand into a local cache. Icon ids encode the vendor as a prefix — `aws:lambda`, `gcp:cloud-run`, `azure:functions`, `iconify:logos:google-cloud` — while unprefixed names continue to resolve against the bundled Lucide set.

### CLI

```bash
seeflow icons list                 # JSON summary of installed + available packs
seeflow icons add aws              # download + extract + index the AWS pack
seeflow icons add azure --accept-terms   # Microsoft requires explicit acceptance
seeflow icons add gcp --pack-url <url>   # override the default download URL
seeflow icons update aws           # re-install (re-downloads from upstream)
seeflow icons remove aws           # drop the pack from cache + index
```

Packs install under `~/.seeflow/icons/<vendor>/<version>/` with a shared `index.json`. Installs are serialized per vendor — a second `seeflow icons add aws` while the first is running waits rather than racing.

### In the studio

Open any icon picker on a canvas node, click **Browse packs** in the picker footer, then **Install** on the vendor row. Azure prompts for license acceptance; AWS and GCP proceed directly. A progress toast tracks bytes downloaded, persists across popover close, and refreshes the picker's vendor tabs the moment the pack is indexed. Vendor tabs (Bundled · AWS · GCP · Azure · Logos) appear above the icon grid; uninstalled vendors render disabled with an inline Install affordance.

## Docker reference

The image is published on [Docker Hub](https://hub.docker.com/r/tuongaz/seeflow). See Quick Start above for the basic `docker run`.

### Configuration

| Variable            | Default                 | Description                                |
| ------------------- | ----------------------- | ------------------------------------------ |
| `SEEFLOW_PORT`      | `4321`                  | Port the studio listens on                 |
| `SEEFLOW_FLOW`      | `flow.json`             | Flow file path relative to the workspace   |
| `SEEFLOW_WORKSPACE` | `/workspace`            | Workspace mount point inside the container |

### Bake demos into a derived image

Ship a container that already contains your flow:

```dockerfile
FROM tuongaz/seeflow
COPY ./my-demos /workspace
# docker build -t my-flow . && docker run --rm -it -p 4321:4321 my-flow
```

### Tags

- `:latest` — newest stable release
- `:<version>` — pinned release (e.g. `:0.1.18`)
- `:<major>.<minor>` — latest patch on a minor line (e.g. `:0.1`)

## MCP server

SeeFlow ships an MCP server — 20 tools to list, register, read, and edit flows — so any MCP-aware editor can drive the studio directly. The studio must be running first.

**Claude Code:**

```bash
claude mcp add seeflow -- npx -y --package=@tuongaz/seeflow@latest seeflow-mcp
```

**Via `.mcp.json`** (Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "seeflow": {
      "command": "npx",
      "args": ["-y", "--package=@tuongaz/seeflow@latest", "seeflow-mcp"]
    }
  }
}
```

The MCP server talks to `http://127.0.0.1:4321/mcp` by default. Override with `SEEFLOW_STUDIO_URL` if needed.

## MCP Apps

On hosts that support the [MCP Apps](https://github.com/modelcontextprotocol/mcp-apps) spec (Claude Desktop today), `seeflow-mcp` renders the React Flow canvas inline in the chat — no second window, no `localhost:4321` tab. You author, navigate, and edit the flow from the same conversation that produced it.

**Install in Claude Desktop** — add an entry to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "seeflow": {
      "command": "npx",
      "args": ["-y", "--package=@tuongaz/seeflow@latest", "seeflow-mcp"]
    }
  }
}
```

When launched this way, `seeflow-mcp` boots an embedded studio on a loopback ephemeral port (the same Hono backend used by `seeflow start`) and serves the iframe canvas as the `ui://seeflow/canvas` resource. One process, one install, no separate studio to run.

**The 5 canvas-bearing tools** open the canvas inline:

| Tool                     | Renders                                                |
| ------------------------ | ------------------------------------------------------ |
| `seeflow_get_flow`       | The flow's canvas (read view).                         |
| `seeflow_get_flow_graph` | Same canvas, with the topology focused.                |
| `seeflow_get_node`       | The canvas with the requested node selected + opened.  |
| `seeflow_register_flow`  | The newly-registered flow in edit mode + "Just created" highlight. |
| `seeflow_create_project` | The new project's canvas in edit mode.                 |

The remaining 15 tools stay JSON-only — their mutations propagate to any open canvas via the studio's SSE channel, no re-render needed.

**Model-notify split.** Edits inside the canvas reach the model through two channels:

- `sendMessage` — structural edits the model should react to (node added / deleted, connector added / deleted, node renamed). Bursts within 200ms are coalesced.
- `updateModelContext` — silent navigation telemetry (selection, hover, drag-in-progress, viewport pan/zoom). Debounced 250ms, throttled to at most 1/sec.

**Non-Apps hosts are unaffected.** The `_meta` payload is additive: hosts that don't grok `openai/outputTemplate` ignore it and continue to receive the same JSON tool responses they've always received. The existing `claude mcp add seeflow …` flow above keeps working unchanged on Claude Code, Cursor, Windsurf, etc.

## Develop

```bash
git clone https://github.com/tuongaz/seeflow.git
cd seeflow && bun install
make dev   # Vite (5173) + Hono studio (4321), both hot-reloading
```

`make help` lists every target. Toolchain: Bun ≥ 1.3, Hono, React Flow, Zod, Biome.

## Status

Early-stage. The schema is stable enough to author against, but expect changes. Issues, ideas, and PRs welcome.

## License

MIT — see [`LICENSE`](./LICENSE).
