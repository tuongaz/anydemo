# SeeFlow

SeeFlow is the bridge between AI coding agents and the humans they work with — a shared canvas both sides read, write, and understand. System/architecture understanding is the flagship use case.

## Language

**Flow**:
A single canvas of nodes and connectors describing one system or story — the core artifact both AI agents and humans author, read, and edit. For newcomers it may be introduced as "a living architecture diagram."
_Avoid_: Demo (dead legacy term — scrub on sight), board, drawing

**Project**:
A named container of one or more flows; the unit that is registered, exported, and shared.
_Avoid_: Repo, workspace

**Node**:
One concept in a flow — a service, datastore, actor, note, table, image, or other element — optionally carrying long-form detail and attachments.

**Connector**:
A directed relationship between two nodes, optionally labeled and annotated with descriptive metadata (e.g. HTTP method) that is documentation, not behavior.
_Avoid_: Edge (React Flow implementation term)

**Canvas**:
The interactive surface a flow is rendered on, in edit, view, or mini mode.

**Studio**:
The local SeeFlow application (backend + UI) that hosts registered projects and serves the canvas.

**Component node**:
A node whose content is an interactive widget declared as a spec — used for rich, explorable explanations on the canvas.
_Avoid_: Widget

**Skill**:
An agent-side workflow that teaches an AI tool to author flows or consult existing ones.

**Sync**:
The propagation of flow edits to every open canvas and connected agent session as they happen.
_Avoid_: Live, living (retired positioning vocabulary)

**Export**:
Publishing a project from the local studio to the cloud for sharing.
_Avoid_: Deploy, upload
