# Homepage Features Section Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the "Everything you need to document reality" bento grid in `apps/viewer/src/pages/home.tsx` with a 7-row alternating-layout features section, each row having an animated HTML/CSS mockup on one side and description text on the other.

**Architecture:** All changes are in a single file (`apps/viewer/src/pages/home.tsx`). Each feature becomes a `FeatureRow` component that accepts props for content and layout direction. Mockup components are inline subcomponents defined above `Home`. The existing bento grid (`grid grid-cols-1 md:grid-cols-3 gap-4`) and its two cards are deleted entirely.

**Tech Stack:** React 18, Tailwind CSS v4, Lucide React, no new dependencies.

---

## Row order and sides

| # | Feature | Mockup side | Description side |
|---|---------|-------------|-----------------|
| 1 | Interactive Canvas | LEFT | RIGHT |
| 2 | Live Status | RIGHT | LEFT |
| 3 | AI-generated flows | LEFT | RIGHT |
| 4 | MCP supported | RIGHT | LEFT |
| 5 | Share your flow | LEFT | RIGHT |
| 6 | Infrastructure committed | RIGHT | LEFT |
| 7 | 100% open source & free | LEFT | RIGHT |

---

### Task 1: Add `FeatureRow` layout component

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `FeatureRow` component above `Home`

**Step 1: Write the component**

Add this above the `Home` function (after `BgGrid`):

```tsx
interface FeatureRowProps {
  reverse?: boolean;
  label: string;
  heading: string;
  body: string;
  bullets?: string[];
  mockup: React.ReactNode;
}

function FeatureRow({ reverse = false, label, heading, body, bullets, mockup }: FeatureRowProps) {
  return (
    <div
      className={`flex flex-col ${reverse ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-center gap-8 lg:gap-16 py-12 md:py-20`}
    >
      {/* Mockup */}
      <div className="w-full lg:w-1/2 flex-shrink-0">{mockup}</div>

      {/* Description */}
      <div className="w-full lg:w-1/2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-700 bg-zinc-800/60 text-xs font-medium text-zinc-400 mb-4 tracking-wide uppercase">
          {label}
        </div>
        <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100 mb-4 leading-snug">
          {heading}
        </h3>
        <p className="text-base text-zinc-400 leading-relaxed mb-4">{body}</p>
        {bullets && bullets.length > 0 && (
          <ul className="space-y-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-zinc-300">
                <CheckCircle size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify `React` import is present**

`import type React from 'react'` is already at line 18. No change needed.

**Step 3: Typecheck**

```bash
cd apps/viewer && bun run typecheck
```

Expected: no errors on `FeatureRow`.

---

### Task 2: Interactive Canvas mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupCanvas` component

**Step 1: Add mockup component above `FeatureRow`**

```tsx
function MockupCanvas() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-500"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <div className="flex gap-1.5 mr-3">
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
        </div>
        checkout-flow.json
      </div>
      <BgGrid className="p-6 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 min-h-[200px]">
        {/* Node A */}
        <div className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg p-3 flex flex-col gap-2 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
            <Server size={13} className="text-zinc-400" />
            Gateway
          </div>
          <div className="text-[11px] text-zinc-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>POST /checkout</div>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            200 OK
          </span>
        </div>

        {/* Arrow */}
        <div className="hidden sm:flex flex-col items-center gap-1 text-zinc-600">
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: "'JetBrains Mono', monospace" }}>HTTP</span>
          <div className="w-10 h-px bg-zinc-700 relative">
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 border-t border-r border-zinc-600 rotate-45" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-emerald-400/60 rounded animate-ping" />
          </div>
        </div>

        {/* Node B */}
        <div className="w-40 bg-zinc-900 border border-amber-500/30 rounded-lg p-3 flex flex-col gap-2 shadow-lg relative">
          <div className="absolute -top-px -left-px -right-px h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
              <CreditCard size={13} className="text-zinc-400" />
              Payment
            </div>
            <RefreshCw size={12} className="text-amber-400 animate-spin" />
          </div>
          <div className="text-[11px] text-zinc-500" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Stripe API</div>
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 w-fit">
            Processing…
          </span>
        </div>
      </BgGrid>
    </div>
  );
}
```

---

### Task 3: Live Status mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupLiveStatus`

**Step 1: Add component**

```tsx
function MockupLiveStatus() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-500"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <div className="flex gap-1.5 mr-3">
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
        </div>
        live-metrics
        <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] uppercase tracking-widest border border-emerald-500/20">
          SSE
        </span>
      </div>
      <div className="p-5 space-y-3">
        {[
          { label: 'SQS Depth', value: '1,204 msgs', color: 'text-amber-400', bar: 72 },
          { label: 'DB Connections', value: '12 / 50', color: 'text-emerald-400', bar: 24 },
          { label: 'API Latency p99', value: '43 ms', color: 'text-blue-400', bar: 30 },
          { label: 'Cache Hit Rate', value: '94.2%', color: 'text-emerald-400', bar: 94 },
        ].map(({ label, value, color, bar }) => (
          <div key={label} className="space-y-1.5">
            <div
              className="flex justify-between text-xs"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <span className="text-zinc-500">{label}</span>
              <span className={color}>{value}</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-1">
              <div
                className="bg-zinc-500 h-1 rounded-full transition-all"
                style={{ width: `${bar}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 4: AI-generated flows mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupAI`

**Step 1: Add component**

```tsx
function MockupAI() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        Terminal
      </div>
      <div className="p-5 text-sm leading-relaxed" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <div className="text-zinc-300 mb-3">
          <span className="text-emerald-400">❯</span> /create-seeflow show me the checkout feature
        </div>
        <div className="text-zinc-500 pl-4 space-y-1 mb-3 text-xs">
          <div>Scanning routes…</div>
          <div>Found 3 services: API Gateway, Payment Worker, Inventory DB.</div>
          <div>Generating seeflow.json…</div>
          <div>Wiring demo scripts…</div>
        </div>
        <div className="flex items-center gap-2 text-zinc-300 pl-4 text-xs">
          <CheckCircle size={13} className="text-emerald-400 shrink-0" />
          Done — canvas ready at localhost:4321
        </div>
        <div className="mt-4 border border-zinc-800 rounded-lg p-3 text-xs">
          <div className="text-zinc-500 mb-1">Works with:</div>
          <div className="flex flex-wrap gap-2">
            {['Claude Code', 'Cursor', 'Windsurf', 'Codex'].map((e) => (
              <span key={e} className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                {e}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 5: MCP supported mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupMCP`

**Step 1: Add component**

```tsx
function MockupMCP() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        .mcp.json
      </div>
      <div className="p-5 text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <pre className="text-zinc-300 leading-relaxed">{`{
  "mcpServers": {
    "seeflow": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "@tuongaz/seeflow",
        "seeflow-mcp"
      ]
    }
  }
}`}</pre>
        <div className="mt-4 border-t border-zinc-800 pt-4 space-y-2">
          <div className="text-zinc-500 mb-2">Available tools</div>
          {['list_demos', 'get_demo', 'add_node', 'patch_connector', 'register_demo'].map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-zinc-300">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

### Task 6: Share your flow mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupShare`

**Step 1: Add component**

```tsx
function MockupShare() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        Export to seeflow.dev
      </div>
      <div className="p-5 space-y-4">
        <div className="space-y-1">
          <div className="text-xs text-zinc-500 mb-1">Name</div>
          <div className="w-full border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 bg-zinc-900">
            checkout-flow
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-zinc-500 mb-1">Visibility</div>
          <div className="flex gap-2">
            <div className="flex-1 border border-emerald-500/40 rounded-md px-3 py-2 text-xs text-emerald-400 bg-emerald-500/10 text-center">
              Public
            </div>
            <div className="flex-1 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-500 text-center">
              Link only
            </div>
          </div>
        </div>
        <div className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm py-2 rounded-lg">
          <Share2 size={14} />
          Publish
        </div>
        <div
          className="border border-zinc-800 rounded-md p-2.5 text-[11px] text-zinc-400 bg-zinc-900/50 flex items-center justify-between gap-2"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span className="truncate text-emerald-400">https://seeflow.dev/flow/abc123</span>
          <Copy size={12} className="shrink-0 text-zinc-500" />
        </div>
      </div>
    </div>
  );
}
```

---

### Task 7: Infrastructure committed mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupGit`

**Step 1: Add component**

```tsx
function MockupGit() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <span className="text-zinc-500 mr-2">$</span> git diff seeflow.json
      </div>
      <div className="p-5 text-xs leading-relaxed" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <div className="space-y-1">
          <div className="text-zinc-500">@@ -12,6 +12,10 @@</div>
          <div className="text-zinc-600 pl-2">{`   "nodes": [`}</div>
          <div className="text-red-400 pl-2">{`-    { "id": "db", "type": "serviceNode" }`}</div>
          <div className="text-emerald-400 pl-2">{`+    {`}</div>
          <div className="text-emerald-400 pl-2">{`+      "id": "db",`}</div>
          <div className="text-emerald-400 pl-2">{`+      "type": "serviceNode",`}</div>
          <div className="text-emerald-400 pl-2">{`+      "data": { "label": "Postgres" }`}</div>
          <div className="text-emerald-400 pl-2">{`+    }`}</div>
          <div className="text-zinc-600 pl-2">{`   ]`}</div>
        </div>
        <div className="mt-4 pt-4 border-t border-zinc-800 flex items-center gap-2 text-zinc-400">
          <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center">
            <Github size={12} />
          </div>
          <span>Committed, reviewed, reverted — just like code.</span>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 8: Open source & free mockup

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — add `MockupOpenSource`

**Step 1: Add component**

```tsx
function MockupOpenSource() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        LICENSE
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Github size={20} className="text-zinc-300" />
          </div>
          <div>
            <div className="text-sm font-medium text-zinc-100">tuongaz/seeflow</div>
            <div className="text-xs text-zinc-500">MIT License</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'License', value: 'MIT', color: 'text-emerald-400' },
            { label: 'Cost', value: 'Free forever', color: 'text-emerald-400' },
            { label: 'Self-hosted', value: 'Yes', color: 'text-emerald-400' },
            { label: 'Account required', value: 'No', color: 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/40">
              <div className="text-xs text-zinc-500 mb-1">{label}</div>
              <div className={`text-sm font-medium ${color}`}>{value}</div>
            </div>
          ))}
        </div>
        <div
          className="flex items-center gap-2 text-xs text-zinc-400 border border-zinc-800 rounded-lg p-3 bg-zinc-900/40"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span className="text-zinc-500">$</span>
          <span>git clone github.com/tuongaz/seeflow</span>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 9: Replace bento section with `FeatureRow` rows

**Files:**
- Modify: `apps/viewer/src/pages/home.tsx` — replace the Features Bento `section` block

**Step 1: Locate and replace the section**

Find the section starting with:
```tsx
{/* Features Bento */}
<section id="features" className="max-w-6xl mx-auto px-6 py-8 md:py-20">
```

Replace the entire section with:

```tsx
{/* Features */}
<section id="features" className="max-w-6xl mx-auto px-6 py-8 md:py-20">
  <div className="mb-6 md:mb-12">
    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100 mb-4">
      Everything you need to document reality.
    </h2>
  </div>

  <div className="divide-y divide-zinc-800/50">
    <FeatureRow
      label="Canvas"
      heading="Click a node. Fire a real request."
      body="Nodes map to real endpoints. Connectors map to real network calls. Click anything on the canvas and watch the graph animate based on actual responses from your running app."
      bullets={['Real HTTP requests, not mocks', 'Animations driven by real responses', 'Nodes wired to REST endpoints or event emitters']}
      mockup={<MockupCanvas />}
    />
    <FeatureRow
      reverse
      label="Live Status"
      heading="Metrics streaming directly from your app."
      body="Nodes pull live tickers from your service via SSE. SQS queue depth, DB connection count, cache hit rate — anything your app can emit, the canvas can display."
      bullets={['SSE-powered real-time updates', 'No polling, no page refresh', 'Any numeric or string metric']}
      mockup={<MockupLiveStatus />}
    />
    <FeatureRow
      label="AI Agent"
      heading="Zero to running demo in one prompt."
      body="The SeeFlow plugin reads your codebase, understands your architecture, and generates the full diagram and demo scripts automatically. No JSON authoring required."
      bullets={['Works with Claude Code, Cursor, Windsurf, Codex', 'Scans routes and database connections', 'Generates seeflow.json and wires demo scripts']}
      mockup={<MockupAI />}
    />
    <FeatureRow
      reverse
      label="MCP"
      heading="Your flow becomes the architecture source."
      body="SeeFlow ships an MCP server so any MCP-aware editor can list, register, query, and edit demos directly. Your diagram isn't just a picture — it's a live data source for your AI agent and team."
      bullets={['Drop-in .mcp.json config for Cursor and Windsurf', 'Claude Code: one-line mcp add command', '5 tools: list, get, add_node, patch_connector, register']}
      mockup={<MockupMCP />}
    />
    <FeatureRow
      label="Share"
      heading="Publish a live link in one click."
      body="Export to seeflow.dev with your email and a name. Choose public or link-only. Anyone with the link can view the diagram — no account, no setup."
      bullets={['Public or link-only visibility', 'Download PDF or PNG for docs', 'Hosted at seeflow.dev/flow/<uuid>']}
      mockup={<MockupShare />}
    />
    <FeatureRow
      reverse
      label="Git"
      heading="Infrastructure that's committed and trackable."
      body="seeflow.json is a plain file that lives in your repo. Diff it in PR review, revert it with git, audit it in CI. Your architecture evolves with your code — not separately from it."
      bullets={['Plain JSON — readable in any diff tool', 'Branch, PR, revert like any other file', 'CI can validate schema on every push']}
      mockup={<MockupGit />}
    />
    <FeatureRow
      label="Open Source"
      heading="100% free. MIT licensed. No accounts."
      body="Run it on your own machine. No cloud dependency, no paywalls, no vendor lock-in. The cloud share feature is optional — everything works fully offline."
      bullets={['MIT license — fork it, embed it, ship it', 'Self-hosted by default', 'No account required for local use']}
      mockup={<MockupOpenSource />}
    />
  </div>
</section>
```

**Step 2: Remove unused imports**

After the edit, check which Lucide icons are still used. The following were only used in the old bento and may now be unused: `MousePointer2`, `Activity`. Remove from the import block if no longer referenced.

**Step 3: Typecheck**

```bash
cd apps/viewer && bun run typecheck
```

Expected: no errors.

**Step 4: Run dev and visually verify**

```bash
cd apps/viewer && bun run dev
```

Open `http://localhost:5173`. Scroll to the Features section and verify:
- 7 rows, alternating sides
- Mockups render without layout overflow
- All text is legible on mobile (stack to single column)

**Step 5: Lint and format**

```bash
cd /path/to/repo && bun run format && bun run lint
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/viewer/src/pages/home.tsx
git commit -m "feat(viewer): redesign features section as alternating-row layout with mockups"
```
