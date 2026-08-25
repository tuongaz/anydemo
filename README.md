# SeeFlow

> Your AI sees JSON; you see pictures.

SeeFlow is a localhost studio for architecture diagrams that an AI coding agent and a human can both work on. A flow is a schema-validated JSON file the agent authors over the CLI or MCP; the studio renders it at `localhost:4321` as a React Flow canvas you explore, edit, and hand back. Nothing leaves your machine.

## Why

- **You can't review what you can't see.** Your agent already has a model of your system — a flow turns it into a picture you can check and correct.
- **What you draw is data the agent reads back.** No screenshots, no "let me describe my architecture": `/seeflow-lookup` hands any agent the same artifact, sliced to the question.
- **It lives in your repo.** Flows are plain JSON files — committed, diffed, and reviewed like code.

## Quick Start

The SeeFlow plugin reads your codebase, works out your architecture, and generates the whole diagram for you. It ships as a plugin for Claude Code and Cursor; other agents (Codex, Windsurf, anything else that speaks MCP) drive the same studio through the [MCP server](#mcp-server).

### 1. Start the studio

```bash
npx -y @tuongaz/seeflow@latest start
# then open http://localhost:4321
```

Requires Bun ≥ 1.3 (or Node with npx). On first start the studio seeds and registers three bundled examples so the canvas has something on it; register your own project with `seeflow register --path .` — it reads a `seeflow.json` manifest at that path, falling back to a bare `flow.json` for pre-manifest projects. The studio binds `127.0.0.1` only — pass `--host 0.0.0.0` if you deliberately want it reachable from your network. The registry persists under `~/.seeflow/` across restarts.

<details>
<summary>Prefer Docker?</summary>

```bash
docker run --rm -it -p 4321:4321 -v $(pwd):/workspace tuongaz/seeflow
```

The image ships with a pre-registered **Order Pipeline** example so you can see the canvas immediately, and it auto-registers the mounted workspace when `/workspace/seeflow.json` is present.

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

The `component` node type turns a canvas node into a json-render-powered reactive UI driven by a small catalog of shadcn-styled primitives (Card, Button, Input, Chart, Markdown, etc.). The spec lives beside the flow, at `<project>/flows/<flow>/nodes/<id>/spec.json` — declaring an element tree, optional initial state, and a typed action vocabulary — while `flow.json` carries only the `type: 'component'` tag. Actions are `set` actions: they mutate the widget's local state via JSON Pointer paths, so the node stays interactive entirely in the browser.

## Icon packs

Cloud vendor icons install on demand into a local cache. Two vendors ship installable packs today — **AWS** and **Azure**. Icon ids encode the vendor as a prefix — `aws:lambda`, `gcp:cloud-run`, `azure:functions`, `iconify:logos:google-cloud` — and all of those prefixes round-trip through the schema, while unprefixed names continue to resolve against the bundled Lucide set.

### CLI

```bash
seeflow icons list                 # JSON summary of installed + available packs
seeflow icons add aws              # download + extract + index the AWS pack
seeflow icons add azure --accept-terms   # Microsoft requires explicit acceptance
seeflow icons add aws --pack-url <url>   # override the default download URL
seeflow icons update aws           # re-install (re-downloads from upstream)
seeflow icons remove aws           # drop the pack from cache + index
```

Packs install under `~/.seeflow/icons/<vendor>/<version>/` with a shared `index.json`. Installs are serialized per vendor — a second `seeflow icons add aws` while the first is running waits rather than racing.

### In the studio

Open any icon picker on a canvas node, click **Browse packs** in the picker footer, then **Install** on the vendor row. Azure prompts for license acceptance; AWS proceeds directly. A progress toast tracks bytes downloaded, persists across popover close, and refreshes the picker's vendor tabs the moment the pack is indexed. Vendor tabs (Bundled · AWS · Azure · Logos · Emoji) appear above the icon grid; uninstalled vendors render disabled with an inline Install affordance.

## Docker reference

The image is published on [Docker Hub](https://hub.docker.com/r/tuongaz/seeflow). See Quick Start above for the basic `docker run`.

### Configuration

| Variable            | Default      | Description                                                          |
| ------------------- | ------------ | -------------------------------------------------------------------- |
| `SEEFLOW_PORT`      | `4321`       | Port the studio listens on                                            |
| `SEEFLOW_HOST`      | `0.0.0.0`    | Bind address. The container needs the wildcard for `-p` to work       |
| `SEEFLOW_WORKSPACE` | `/workspace` | Workspace mount point inside the container                            |
| `SEEFLOW_FLOW`      | `flow.json`  | Legacy single-flow file, relative to the workspace. Ignored when the workspace has a `seeflow.json` |

The entrypoint auto-registers the workspace when `$SEEFLOW_WORKSPACE/seeflow.json` exists (or, for
pre-manifest projects, `$SEEFLOW_WORKSPACE/$SEEFLOW_FLOW`).

### Bake flows into a derived image

Ship a container that already contains your flows. The copied tree needs a `seeflow.json`
manifest at its root, with each flow under `flows/<id>/flow.json`:

```dockerfile
FROM tuongaz/seeflow
COPY ./my-flows /workspace
# docker build -t my-flow . && docker run --rm -it -p 4321:4321 my-flow
```

### Tags

- `:latest` — newest stable release
- `:<version>` — pinned release (e.g. `:0.7.0`)
- `:<major>.<minor>` — latest patch on a minor line (e.g. `:0.7`)

## MCP server

SeeFlow ships an MCP server — 20 tools to list, register, read, and edit flows — so any MCP-aware editor can drive the studio directly. Nothing needs to be running first: `seeflow-mcp` boots its own embedded studio.

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

By default `seeflow-mcp` runs an embedded studio on an ephemeral loopback port and talks to that. Set `SEEFLOW_STUDIO_URL` to proxy to an already-running studio instead (e.g. `http://127.0.0.1:4321/mcp` for one started with `seeflow start`).

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
| `seeflow_get_flow`       | The flow's canvas.                                     |
| `seeflow_get_flow_graph` | Same canvas, with the topology focused.                |
| `seeflow_get_node`       | The canvas with the requested node selected + opened.  |
| `seeflow_register_flow`  | The newly-registered flow, with a "Just created" highlight. |
| `seeflow_create_project` | The new project's canvas.                              |

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
