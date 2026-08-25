# Changelog

## 0.2.0

- **BREAKING:** remove the Live Share surface. The following public exports are gone: `IoAdapter`, `IoAdapterDispatchEnvelope`, `IoAdapterResult`, `CanvasSseEvent`, `AttributionToastStack`, `AttributionToastItem`, `AttributionToastStackProps`, `formatAttribution`, `FormatAttributionResult`, `PeerCursorsLayer`, `PeerCursor`, `PeerCursorsLayerProps`. On `<SeeflowCanvas>`: the `ioAdapter`, `presenceLayer`, and `onCursorMove` props are removed. On `<ShareMenu>`: the `onLiveShare` prop is removed (other items — Download PDF/PNG, Embed, Export to seeflow.dev — are unaffected). Consumers wiring a peer-transport seam should pin to `@seeflow/canvas@0.1.x`.

## Unreleased

- **BREAKING:** remove the cloud publish / share / embed surface, retired with `cloud.seeflow.dev`. The following public exports are gone: `EmbedDialog`, `ShareMenuMode`, `NodeCapabilities`, `resolveFileSrc`. On `<SeeflowCanvas>` / `<ShareMenu>`: the `onExportToCloud`, `onShareWithMembers`, and `enableEmbed` props are removed, as is `openEmbedDialog()` on the canvas ref handle and the `capturePreview()` helper that fed the publish flow. Downloading a flow as PNG or PDF is unaffected — those items stay on `<ShareMenu>`.
- fix(export): apply the canvas dark background (`--bg-canvas`) to PNG / PDF exports so downloads match the in-app canvas instead of rendering on transparent / white.
- Tailwind v4: requires Safari 16.4+, Chrome 111+, Firefox 128+ in consuming browsers.
