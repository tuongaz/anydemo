# Record Canvas → GIF

Capture a SeeFlow canvas session as an animated GIF the user can download or paste into Slack/PRs.

## Goals

- One-click record of the live canvas viewport: nodes, edges, status animations, SSE-driven changes.
- Output is a GIF — autoplay-friendly on Slack, GitHub, Twitter, READMEs.
- Idle stretches collapse: a 5-minute session with 10 seconds of action becomes a ~10-second GIF.
- Real-time pacing preserved: a 3-second pause between events feels like a 3-second pause in the GIF.
- Zero backend work, zero permission prompts, ~20 KB extra bundle.

## Non-goals

- No mouse-cursor or click overlay in the recording.
- No "auto-record this Play" trigger. Manual start/stop only.
- No video (MP4/WebM) output. GIF only.
- No editing UI (trim, crop, speed-change) beyond what falls out for free.
- Recording is not available in `mini` mode.

## Architecture

Lives in `@seeflow/canvas`, mirroring the existing PNG/PDF export pattern (`use-canvas-export.ts` + the `SeeflowCanvasHandle` imperative ref). All hosts — local studio, embedded view, `seeflow.dev` cloud — pick it up for free.

```
┌───────────────────────────────────────────────────────────────┐
│  ShareMenu  ──click "Record GIF"──►  SeeflowCanvasHandle      │
│                                       .startRecording()       │
│                                                               │
│  RecordingButton (top-center) ◄── recorderState               │
│       │                                                       │
│       └─ click ──► .stopRecording()                           │
│                                                               │
│  ┌─ useCanvasRecorder ────────────────────────────────────┐   │
│  │   setInterval(~100ms)                                  │   │
│  │     html-to-image.toPng(.react-flow__viewport)         │   │
│  │       → createImageBitmap                              │   │
│  │       → OffscreenCanvas downscale to 800px wide        │   │
│  │       → ImageData                                      │   │
│  │       → 32×32 thumbnail hash (FNV-1a)                  │   │
│  │       → if hash === lastHash: skip                     │   │
│  │       → else: gifenc.writeFrame(palette, delayMs)      │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                               │
│  on stop ──► flush gifenc ──► Blob ──► Result dialog          │
└───────────────────────────────────────────────────────────────┘
```

## Capture path

Reuses the same DOM target as `captureViewportPng` (`.react-flow__viewport`). The first frame fires `fitView` once so the diagram is framed. Subsequent frames snapshot the viewport as the user sees it — no re-fit, no disturbing pan/zoom mid-recording.

```ts
type RecorderState = {
  startedAt: number;            // performance.now() at Start
  lastFrameAt: number;          // performance.now() of last accepted frame
  lastHash: number | null;      // FNV-1a hash of last 32×32 thumb
  palette: Uint8Array | null;   // built from first accepted frame, reused
  gif: GIFEncoder;              // gifenc handle
  acceptedFrames: number;
  errorStreak: number;          // consecutive capture failures
  targetWidth: number;          // fixed at first frame
  targetHeight: number;
};
```

Each tick (≈100ms, max ~10 fps):

1. `toPng(viewportEl)` → data URL → `createImageBitmap` (off-main-thread decode).
2. Draw to `OffscreenCanvas` at 800px wide (preserve aspect ratio). On the first frame, lock `targetWidth` / `targetHeight` for the whole session.
3. `getImageData` → RGBA `Uint8ClampedArray`.
4. Downsample to a 32×32 thumb, FNV-1a hash that.
5. If `hash === lastHash`: drop. No write, no delta-time update.
6. Else: `deltaMs = now − lastFrameAt`, clamped to `[10, 30000]`. Quantize and write the frame to gifenc with `delay = deltaMs`.
7. Update `lastHash`, `lastFrameAt`, increment `acceptedFrames`.

### Why downscale before hashing

A 1600×1000 RGBA buffer is ~6 MB per frame. Hashing at full size every 100ms saturates the main thread. A 32×32 thumbnail (4 KB) still detects every meaningful diagram change — status badge color, edge state, node movement — and aligns with gifenc's downstream quantization.

### Why a fixed palette

Quantize the first accepted frame to 256 colors, reuse that palette for every subsequent frame. Diagrams have a small color vocabulary (background, node fills, status colors, edge colors). Fixed palette is faster *and* yields smaller GIFs than per-frame palettes.

## Frame timing

GIFs encode a per-frame delay in centiseconds. The delay written to frame N is the elapsed time *until* frame N+1, so a 3-second idle stretch becomes a 3-second pause on the previous frame. No extra bookkeeping required to preserve real-time gaps.

Clamp `deltaMs` to `[10, 30000]`:

- Lower bound: 10ms is gifenc's minimum.
- Upper bound: 30s keeps any single frame interpretable. If something idles longer, the next captured-but-different frame still resumes correctly.

On `stopRecording()`: flush a final frame with `delay = 200ms` so the GIF doesn't end mid-pause, then `gif.finish()` and wrap the `Uint8Array` in a `Blob({ type: 'image/gif' })`.

## UI

### Entry point

Add a "Record GIF" item to `ShareMenu` (top-right). Gated on a new chrome flag `enableRecording`, default `true` for `edit` + `view`, `false` for `mini` — same pattern as `enableEmbed`. Click → calls `startRecording()` via the imperative handle. No pre-dialog; zero friction.

### Recording-button surface

While recording, render a single circular button at the **top-center of the canvas** (inside `.seeflow-canvas-root` so it inherits scoped tokens):

- Center: solid `bg-destructive` red dot.
- Border: 2px dashed ring with a slow rotation (`@keyframes spin-ring` at `3s linear infinite`) using `border-image` or a conic gradient via Tailwind v4 utilities so it telegraphs "live."
- Click → `stopRecording()`. `aria-label="Stop recording"`, `aria-pressed="true"`.

States the same button cycles through:

| State      | Visual                                       |
|------------|----------------------------------------------|
| Idle       | Not rendered (ShareMenu item is the entry).  |
| Recording  | Red dot + spinning border ring.              |
| Encoding   | `Loader2` spinner replacing the dot.         |
| Done       | Button disappears, result dialog opens.      |

While `isRecording()` is true, PNG / PDF / Embed items in `ShareMenu` are disabled — they share the fit-view path and would collide.

### Result dialog

Reuse `Dialog` from `src/ui/`. Contents:

- Preview thumbnail (first frame).
- File size, frame count, duration ("12 frames · 4.3 s · 412 KB").
- Buttons: **Download GIF**, **Copy to clipboard** (`navigator.clipboard.write([new ClipboardItem({ 'image/gif': blob })])`), **Discard**.

No automatic download — the user decides.

### Studio command palette

Add a "Record GIF" command in the apps/web command palette bound to the canvas handle. Default keyboard shortcut: `R`.

### Discard-on-navigate guard

If `isRecording()` and the user tries to switch projects or close the tab, raise a `beforeunload` confirm: "Discard active recording?" Standard screen-recorder behavior.

## Public API

Add to `SeeflowCanvasHandle`:

```ts
type SeeflowCanvasHandle = {
  // existing...
  startRecording(): Promise<void>;
  stopRecording(): Promise<Blob | null>;
  isRecording(): boolean;
};
```

Add to `CanvasFeatureOverrides`:

```ts
type CanvasFeatureOverrides = {
  // existing...
  enableRecording?: boolean;
};
```

New hook (internal):

```ts
// src/hooks/use-canvas-recorder.ts
export interface UseCanvasRecorderInput {
  projectId?: string | null;
  getReactFlow: () => ReactFlowInstance | null;
}
export interface UseCanvasRecorderApi {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  isRecording: () => boolean;
  recordingState: 'idle' | 'recording' | 'encoding';
  acceptedFrames: number;
  lastError: string | null;
  clearError: () => void;
}
```

## Edge cases

- **Tab backgrounded.** Pause capture entirely while `document.visibilityState === 'hidden'`. Resume on `visibilitychange`. The button stays in its recording state — no fake delays accumulate.
- **Viewport resize mid-recording.** Lock `targetWidth` / `targetHeight` to the first frame. Subsequent frames are letterboxed to fit. Avoids dimension-change flicker in viewers.
- **Memory ceiling.** Soft cap: 2000 accepted frames. At cap, auto-stop with a toast: "Recording capped at 2000 frames — saved automatically." gifenc is incremental, so headroom is bounded by the cap, not session length.
- **Concurrent exports.** Disable PNG/PDF/Embed menu items while `isRecording()` — they share the fit-view path.
- **html-to-image failure mid-recording.** Skip the tick; increment `errorStreak`. After 5 consecutive failures, abort with the standard error toast (`lastError` populated, surfaced inline next to the recording button).
- **OffscreenCanvas unsupported (rare).** Fall back to a hidden `<canvas>` in the document. Feature-detect once at recorder construction.

## Testing

Mirrors the existing `*.test.ts` conventions in `packages/canvas/src/`:

- `src/hooks/use-canvas-recorder.test.ts` — unit tests for hash dedup, `deltaMs` accounting and clamping, accepted-frame counting, soft-cap auto-stop, visibility-pause logic. Mock `html-to-image` and `gifenc`.
- `src/components/recording-button.test.tsx` — render states (recording / encoding), click handler invokes `stopRecording`, accessibility attributes.
- `src/components/seeflow-canvas.test.tsx` — extend the imperative-handle test (US-014) to cover `startRecording` / `stopRecording` / `isRecording`. **Append the new `useState` for recording state at the end of the body** (slot 13) per the hook-shim test rule in `packages/canvas/CLAUDE.md`.
- gifenc integration smoke test: feed 3 synthetic `ImageData` frames, assert output `Blob` begins with the `GIF89a` magic bytes and the IMAGE_TRAILER `0x3B`.

## Dependencies

- `gifenc` (~20 KB, MIT). Added to `packages/canvas/package.json` `dependencies`.
- `html-to-image` — already present, no version change.
- No backend changes.
- No new peer deps.

## File touch list

- `packages/canvas/src/hooks/use-canvas-recorder.ts` *(new)*
- `packages/canvas/src/hooks/use-canvas-recorder.test.ts` *(new)*
- `packages/canvas/src/lib/frame-hash.ts` *(new — FNV-1a 32×32 thumb hash, pure fn, unit-tested)*
- `packages/canvas/src/lib/frame-hash.test.ts` *(new)*
- `packages/canvas/src/components/recording-button.tsx` *(new)*
- `packages/canvas/src/components/recording-button.test.tsx` *(new)*
- `packages/canvas/src/components/recording-result-dialog.tsx` *(new)*
- `packages/canvas/src/components/recording-result-dialog.test.tsx` *(new)*
- `packages/canvas/src/components/seeflow-canvas.tsx` — add useState slot 13, wire `useCanvasRecorder`, render `<RecordingButton>` + `<RecordingResultDialog>`, expose handle methods.
- `packages/canvas/src/components/seeflow-canvas.test.tsx` — extend US-014 imperative-handle test.
- `packages/canvas/src/components/share-menu.tsx` — add "Record GIF" item, disable PNG/PDF/Embed while recording.
- `packages/canvas/src/components/share-menu.test.tsx` — assertions for the new item + disabled-during-recording state.
- `packages/canvas/src/types.ts` — `enableRecording?: boolean` on `CanvasFeatureOverrides`; new handle methods on `SeeflowCanvasHandle`.
- `packages/canvas/src/lib/flag-resolver.ts` (wherever `resolveFlags` lives) — default `enableRecording` per mode.
- `packages/canvas/src/index.ts` — export anything new that's part of the public API.
- `packages/canvas/package.json` — `gifenc` dependency.
- `apps/web/src/components/command-palette.tsx` — "Record GIF" command, `R` shortcut.

## Open questions deferred to implementation

- Exact ring-spin animation: pure CSS `@keyframes` rotating a `conic-gradient` background-clipped to a 2px ring works in Tailwind v4 — to be confirmed during build.
- Whether to expose `enableRecording` as a documented prop or keep it implicit (default-on for edit + view, off for mini). Lean documented.
- Whether the `R` shortcut conflicts with any existing studio binding — to be verified against `keyboard-shortcuts.ts`.
