import {
  Activity,
  CheckCircle,
  Copy,
  CreditCard,
  Database,
  FileX,
  Github,
  PlayCircle,
  RefreshCw,
  Server,
  Share2,
  Users,
  Workflow,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import { FlowCard } from '../components/flow-card';
import { HeroAnimation } from '../components/hero-animation/scenes';
import { fetchFlows } from '../lib/viewer-api';
import type { FlowsResponse } from '../types';

type DiscoverState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; data: FlowsResponse };

function DiscoverSkeletonCard() {
  return (
    <div
      style={{
        border: '1px solid #e4e4e7',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        width: '100%',
      }}
    >
      <div
        className="animate-pulse"
        style={{ width: '100%', aspectRatio: '16 / 9', background: '#f1f5f9' }}
      />
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div
          className="animate-pulse"
          style={{ width: '60%', height: '1.25rem', background: '#e2e8f0', borderRadius: '4px' }}
        />
        <div
          className="animate-pulse"
          style={{ width: '20%', height: '1rem', background: '#e2e8f0', borderRadius: '4px' }}
        />
      </div>
    </div>
  );
}

function DiscoverSection() {
  const navigate = useNavigate();
  const [state, setState] = useState<DiscoverState>({ status: 'loading' });

  useEffect(() => {
    fetchFlows(1, 6)
      .then((data) => setState({ status: 'done', data }))
      .catch(() => setState({ status: 'error' }));
  }, []);

  if (state.status === 'error') return null;
  if (state.status === 'done' && state.data.flows.length === 0) return null;

  return (
    <section className="max-w-6xl mx-auto px-6 py-8 md:py-20 border-t border-zinc-800/50">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
        }}
      >
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100">
          Discover recent flows
        </h2>
        <Link
          to="/flows"
          style={{ fontSize: '0.875rem', color: '#a1a1aa', textDecoration: 'none' }}
        >
          View all →
        </Link>
      </div>

      {state.status === 'loading' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <DiscoverSkeletonCard key={i} />
          ))}
        </div>
      )}

      {state.status === 'done' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {state.data.flows.map((flow) => (
            <FlowCard key={flow.uuid} flow={flow} onClick={() => navigate(`/flow/${flow.uuid}`)} />
          ))}
        </div>
      )}
    </section>
  );
}

function BgGrid({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={className}
      style={{
        backgroundSize: '32px 32px',
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)',
      }}
    >
      {children}
    </div>
  );
}

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
      <div className="w-full lg:w-1/2 flex-shrink-0">{mockup}</div>
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
        <div className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg p-3 flex flex-col gap-2 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
            <Server size={13} className="text-zinc-400" />
            Gateway
          </div>
          <div
            className="text-[11px] text-zinc-500"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            POST /checkout
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded border border-emerald-400/20 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            200 OK
          </span>
        </div>
        <div className="hidden sm:flex flex-col items-center gap-1 text-zinc-600">
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            HTTP
          </span>
          <div className="w-10 h-px bg-zinc-700 relative">
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 border-t border-r border-zinc-600 rotate-45" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-emerald-400/60 rounded animate-ping" />
          </div>
        </div>
        <div className="w-40 bg-zinc-900 border border-amber-500/30 rounded-lg p-3 flex flex-col gap-2 shadow-lg relative">
          <div className="absolute -top-px -left-px -right-px h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
              <CreditCard size={13} className="text-zinc-400" />
              Payment
            </div>
            <RefreshCw size={12} className="text-amber-400 animate-spin" />
          </div>
          <div
            className="text-[11px] text-zinc-500"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            Stripe API
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 w-fit">
            Processing…
          </span>
        </div>
      </BgGrid>
    </div>
  );
}

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

function MockupAI() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        Terminal
      </div>
      <div
        className="p-5 text-sm leading-relaxed"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <div className="text-zinc-300 mb-3">
          <span className="text-emerald-400">❯</span> /seeflow show me the checkout feature
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
              <span
                key={e}
                className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300"
              >
                {e}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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

function MockupGit() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
      <div
        className="flex items-center px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <span className="text-zinc-500 mr-2">$</span> git diff seeflow.json
      </div>
      <div
        className="p-5 text-xs leading-relaxed"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <div className="space-y-1">
          <div className="text-zinc-500">@@ -12,6 +12,10 @@</div>
          <div className="text-zinc-600 pl-2">{`   "nodes": [`}</div>
          <div className="text-red-400 pl-2">{`-    { "id": "db", "type": "serviceNode" }`}</div>
          <div className="text-emerald-400 pl-2">{'+    {'}</div>
          <div className="text-emerald-400 pl-2">{`+      "id": "db",`}</div>
          <div className="text-emerald-400 pl-2">{`+      "type": "serviceNode",`}</div>
          <div className="text-emerald-400 pl-2">{`+      "data": { "label": "Postgres" }`}</div>
          <div className="text-emerald-400 pl-2">{'+    }'}</div>
          <div className="text-zinc-600 pl-2">{'   ]'}</div>
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

export function Home() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText('npx tuongaz/seeflow start');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="antialiased flex flex-col min-h-screen"
      style={{
        fontFamily: "'Inter', sans-serif",
        backgroundColor: '#09090b',
        color: '#e4e4e7',
        scrollBehavior: 'smooth',
      }}
    >
      <Helmet>
        <title>SeeFlow | Architecture diagrams that actually run</title>
      </Helmet>
      {/* Header */}
      <header className="fixed top-0 w-full z-50 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-zinc-100 font-semibold tracking-tight text-lg hover:opacity-75 transition-opacity"
            style={{ textDecoration: 'none', cursor: 'pointer' }}
          >
            <Workflow size={20} className="text-emerald-400" />
            SeeFlow
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <a href="#features" className="hover:text-zinc-100 transition-colors">
              Features
            </a>
            <a href="#ai" className="hover:text-zinc-100 transition-colors">
              How to Use
            </a>
          </nav>
          <a
            href="https://github.com/tuongaz/seeflow"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-100 transition-colors"
            aria-label="GitHub"
          >
            <Github size={20} />
          </a>
        </div>
      </header>

      <main className="flex-grow pt-24 pb-12 md:pb-20">
        {/* Hero */}
        <section className="relative max-w-6xl mx-auto px-6 pt-6 md:pt-24 pb-8 md:pb-16 text-center">
          <BgGrid className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]" />

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-xs font-medium text-emerald-400 mb-6 backdrop-blur-sm">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            100% free &amp; open source
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-zinc-100 mb-6 max-w-4xl mx-auto leading-tight">
            Architecture diagrams that{' '}
            <span
              className="bg-gradient-to-r from-emerald-400 to-emerald-200"
              style={{
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              actually run.
            </span>
          </h1>

          <p className="text-base md:text-xl text-zinc-400 max-w-2xl mx-auto mb-6 md:mb-10 leading-relaxed font-medium">
            Turn your static system architecture into a live control panel wired directly to your
            running application.
          </p>

          <div className="flex items-center justify-center">
            <div
              className="flex items-center justify-between w-full sm:w-auto bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-300"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <span className="text-zinc-500 mr-4">$</span>
              npx tuongaz/seeflow start
              <button
                type="button"
                onClick={handleCopy}
                className="ml-4 text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Copy command"
              >
                {copied ? (
                  <CheckCircle size={14} className="text-emerald-400" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            </div>
          </div>

          {/* Hero animation */}
          <div
            className="mt-8 md:mt-16 rounded-xl border border-zinc-800/60 overflow-hidden"
            style={{
              aspectRatio: '16/9',
              boxShadow: '0 0 60px -10px rgba(16,185,129,0.2)',
              position: 'relative',
            }}
          >
            <HeroAnimation />
          </div>
        </section>

        {/* AI Integration */}
        <section id="ai" className="py-8 md:py-20 border-t border-zinc-800/50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex flex-col lg:flex-row items-center gap-6 md:gap-12">
              <div className="lg:w-1/2">
                <h2 className="text-3xl font-semibold tracking-tight text-zinc-100 mb-4">
                  Zero to running demo in one prompt.
                </h2>
                <p className="text-zinc-400 text-base leading-relaxed mb-4 md:mb-6">
                  Don't want to write JSON? The SeeFlow AI Agent Skill reads your codebase,
                  understands your architecture, and generates the full diagram and request scripts
                  automatically.
                </p>
                <ul className="space-y-3 mb-5 md:mb-8 text-sm text-zinc-300">
                  <li className="flex items-start gap-2">
                    <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>Scans routes and database connections</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>
                      Generates{' '}
                      <code className="bg-zinc-800 px-1 rounded text-xs text-zinc-400">
                        seeflow.json
                      </code>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
                    <span>Works with Claude Code, Codex, Cursor, and Windsurf</span>
                  </li>
                </ul>
              </div>

              <div className="lg:w-1/2 w-full">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
                  <div
                    className="flex items-center px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 text-xs text-zinc-400"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    Terminal
                  </div>
                  <div
                    className="p-4 text-sm leading-relaxed"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    <div className="text-zinc-300 mb-2">
                      <span className="text-emerald-400">❯</span> /seeflow show me the shopping cart
                      feature
                    </div>
                    <div className="text-zinc-500 pl-4 mb-2">
                      Analyzing codebase...
                      <br />
                      Found 3 services: API Gateway, Payment Worker, Inventory DB.
                      <br />
                      Generating seeflow.json...
                      <br />
                      Wiring up demo scripts...
                    </div>
                    <div className="text-zinc-300 pl-4 flex items-center gap-2">
                      <CheckCircle size={14} className="text-emerald-400" />
                      Success! Diagram running on localhost:4321
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section
          id="problem"
          className="max-w-6xl mx-auto px-6 py-8 md:py-20 border-t border-zinc-800/50"
        >
          <div className="text-center mb-8 md:mb-16">
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-100 mb-4">
              Static diagrams are dead on arrival.
            </h2>
            <p className="text-zinc-400 text-base font-medium max-w-2xl mx-auto">
              We build dynamic systems and document them with static pictures. It's time for tooling
              that matches reality.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <FileX size={20} />,
                title: 'Diagram Drift',
                body: 'Confluence pages go stale six months later. SeeFlow breaks loudly when your actual system changes.',
              },
              {
                icon: <Users size={20} />,
                title: 'Onboarding Friction',
                body: 'Stop making new hires read walls of text. Let them click through a live flow and understand the system in 30 minutes.',
              },
              {
                icon: <Activity size={20} />,
                title: 'Demo Tedium',
                body: 'Manually clicking through microservices to show stakeholders is painful. Script it once, replay it flawlessly forever.',
              },
            ].map(({ icon, title, body }) => (
              <div key={title} className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/30">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-300 mb-4 border border-zinc-700">
                  {icon}
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">{title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="py-8 md:py-20 bg-zinc-900/20 border-y border-zinc-800/50">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 relative">
              <div className="hidden md:block absolute top-6 left-1/6 right-1/6 h-px bg-zinc-800 -z-10" />

              <div className="text-center">
                <div
                  className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-700 text-zinc-300 flex items-center justify-center mx-auto mb-6 text-xl"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  1
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">
                  Ask your favourite vibe code editor
                </h3>
                <p className="text-sm text-zinc-400">
                  Use the SeeFlow plugin in Claude Code, Cursor, Windsurf, or Codex to generate your
                  diagram from your codebase in seconds.
                </p>
              </div>

              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-6">
                  <PlayCircle size={22} />
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">
                  Play the Flow
                </h3>
                <p className="text-sm text-zinc-400">
                  Click a node. SeeFlow fires real HTTP requests or events and animates the diagram
                  based on real responses.
                </p>
              </div>

              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-zinc-950 border border-zinc-700 text-zinc-300 flex items-center justify-center mx-auto mb-6">
                  <Share2 size={20} />
                </div>
                <h3 className="text-lg font-medium text-zinc-100 mb-2 tracking-tight">
                  Share the Truth
                </h3>
                <p className="text-sm text-zinc-400">
                  Export to a shareable cloud link. Product, Sales, and QA can view the live
                  system—no setup required.
                </p>
              </div>
            </div>
          </div>
        </section>

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
              bullets={[
                'Real HTTP requests, not mocks',
                'Animations driven by real responses',
                'Nodes wired to REST endpoints or event emitters',
              ]}
              mockup={<MockupCanvas />}
            />
            <FeatureRow
              reverse
              label="Live Status"
              heading="Metrics streaming directly from your app."
              body="Nodes pull live tickers from your service via SSE. SQS queue depth, DB connection count, cache hit rate — anything your app can emit, the canvas can display."
              bullets={[
                'SSE-powered real-time updates',
                'No polling, no page refresh',
                'Any numeric or string metric',
              ]}
              mockup={<MockupLiveStatus />}
            />
            <FeatureRow
              label="AI Agent"
              heading="Zero to running demo in one prompt."
              body="The SeeFlow plugin reads your codebase, understands your architecture, and generates the full diagram and demo scripts automatically. No JSON authoring required."
              bullets={[
                'Works with Claude Code, Cursor, Windsurf, Codex',
                'Scans routes and database connections',
                'Generates seeflow.json and wires demo scripts',
              ]}
              mockup={<MockupAI />}
            />
            <FeatureRow
              reverse
              label="MCP"
              heading="Your flow becomes the architecture source."
              body="SeeFlow ships an MCP server so any MCP-aware editor can list, register, query, and edit demos directly. Your diagram isn't just a picture — it's a live data source for your AI agent and team."
              bullets={[
                'Drop-in .mcp.json config for Cursor and Windsurf',
                'Claude Code: one-line mcp add command',
                '5 tools: list, get, add_node, patch_connector, register',
              ]}
              mockup={<MockupMCP />}
            />
            <FeatureRow
              label="Share"
              heading="Publish a live link in one click."
              body="Export to seeflow.dev with your email and a name. Choose public or link-only. Anyone with the link can view the diagram — no account, no setup."
              bullets={[
                'Public or link-only visibility',
                'Download PDF or PNG for docs',
                'Hosted at seeflow.dev/flow/<uuid>',
              ]}
              mockup={<MockupShare />}
            />
            <FeatureRow
              reverse
              label="Git"
              heading="Infrastructure that's committed and trackable."
              body="seeflow.json is a plain file that lives in your repo. Diff it in PR review, revert it with git, audit it in CI. Your architecture evolves with your code — not separately from it."
              bullets={[
                'Plain JSON — readable in any diff tool',
                'Branch, PR, revert like any other file',
                'CI can validate schema on every push',
              ]}
              mockup={<MockupGit />}
            />
            <FeatureRow
              label="Open Source"
              heading="100% free. MIT licensed. No accounts."
              body="Run it on your own machine. No cloud dependency, no paywalls, no vendor lock-in. The cloud share feature is optional — everything works fully offline."
              bullets={[
                'MIT license — fork it, embed it, ship it',
                'Self-hosted by default',
                'No account required for local use',
              ]}
              mockup={<MockupOpenSource />}
            />
          </div>
        </section>
      </main>

      <DiscoverSection />

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 bg-zinc-950 py-8 md:py-12">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold tracking-tight text-lg">
            <Workflow size={18} className="text-emerald-400" />
            SeeFlow
          </div>
          <div className="flex gap-6 text-sm text-zinc-400 font-medium">
            {[
              { label: 'GitHub', href: 'https://github.com/tuongaz/seeflow' },
              { label: 'X', href: 'https://x.com/tuongaz' },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-100 transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="text-sm text-zinc-500">© 2026 SeeFlow. The living truth.</div>
        </div>
      </footer>
    </div>
  );
}
