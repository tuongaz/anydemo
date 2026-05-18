import type React from 'react';
import { Easing, Sprite, Stage, clamp, useSprite, useTime } from './animation';

const C = {
  bg: '#09090b',
  surface: '#18181b',
  border: '#27272a',
  borderHi: '#3f3f46',
  text: '#fafafa',
  textMute: '#a1a1aa',
  textDim: '#71717a',
  textFaint: '#52525b',
  emerald: '#10b981',
  emeraldHi: '#34d399',
  emeraldGlow: 'rgba(16,185,129,0.35)',
  amber: '#f59e0b',
  amberHi: '#fbbf24',
};
const FONT_SANS = 'Inter, system-ui, sans-serif';
const FONT_MONO = 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace';

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function GridBackdrop() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: C.bg,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </div>
  );
}

function Wordmark({
  x,
  y,
  size = 28,
  opacity = 1,
}: { x: number; y: number; size?: number; opacity?: number }) {
  const s = size;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        display: 'flex',
        alignItems: 'center',
        gap: s * 0.4,
        opacity,
        fontFamily: FONT_SANS,
        color: C.text,
        fontWeight: 600,
        fontSize: s,
        letterSpacing: '-0.02em',
      }}
    >
      <svg
        aria-hidden="true"
        width={s * 1.1}
        height={s * 1.1}
        viewBox="0 0 24 24"
        fill="none"
        stroke={C.emeraldHi}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="8" height="8" x="3" y="3" rx="2" />
        <path d="M7 11v4a2 2 0 0 0 2 2h4" />
        <rect width="8" height="8" x="13" y="13" rx="2" />
      </svg>
      <span>SeeFlow</span>
    </div>
  );
}

interface WindowFrameProps {
  x: number;
  y: number;
  width: number;
  height: number;
  title: React.ReactNode;
  badge?: string;
  children?: React.ReactNode;
  opacity?: number;
  scale?: number;
}

function WindowFrame({
  x,
  y,
  width,
  height,
  title,
  badge,
  children,
  opacity = 1,
  scale = 1,
}: WindowFrameProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'center center',
        background: 'rgba(9,9,11,0.6)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: `0 30px 80px -20px rgba(0,0,0,0.6), 0 0 60px -20px ${C.emeraldGlow}`,
      }}
    >
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          borderBottom: `1px solid ${C.border}`,
          background: 'rgba(24,24,27,0.7)',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: C.borderHi }} />
          <div style={{ width: 12, height: 12, borderRadius: 6, background: C.borderHi }} />
          <div style={{ width: 12, height: 12, borderRadius: 6, background: C.borderHi }} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: FONT_MONO,
            fontSize: 14,
            color: C.textDim,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>{title}</span>
          {badge && (
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(16,185,129,0.12)',
                color: C.emeraldHi,
                fontSize: 10,
                letterSpacing: '0.15em',
                border: '1px solid rgba(16,185,129,0.25)',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {badge}
            </span>
          )}
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', height: 'calc(100% - 44px)' }}>
        {children}
      </div>
    </div>
  );
}

interface TypewriterProps {
  text: string;
  x: number;
  y: number;
  font?: string;
  size?: number;
  color?: string;
  delay?: number;
  duration?: number;
  caret?: boolean;
}

function Typewriter({
  text,
  x,
  y,
  font = FONT_MONO,
  size = 24,
  color = C.text,
  delay = 0,
  duration = 1.2,
  caret = true,
}: TypewriterProps) {
  const { localTime } = useSprite();
  const t = Math.max(0, localTime - delay);
  const ratio = duration > 0 ? Math.min(1, t / duration) : 1;
  const chars = Math.floor(ratio * text.length);
  const shown = text.slice(0, chars);
  const showCaret = caret && localTime - delay > -0.05;
  const caretBlink = Math.floor((localTime - delay) * 2) % 2 === 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        fontFamily: font,
        fontSize: size,
        color,
        whiteSpace: 'pre',
      }}
    >
      {shown}
      {showCaret && (
        <span
          style={{
            display: 'inline-block',
            width: size * 0.55,
            height: size * 1.05,
            background: caretBlink ? C.emeraldHi : 'transparent',
            verticalAlign: 'text-bottom',
            marginLeft: 2,
          }}
        />
      )}
    </div>
  );
}

interface LineProps {
  text: string;
  x: number;
  y: number;
  opacity?: number;
  color?: string;
  size?: number;
  font?: string;
  weight?: number;
}

function Line({
  text,
  x,
  y,
  opacity = 1,
  color = C.textMute,
  size = 20,
  font = FONT_MONO,
  weight = 400,
}: LineProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        fontFamily: font,
        fontSize: size,
        color,
        opacity,
        fontWeight: weight,
        whiteSpace: 'pre',
      }}
    >
      {text}
    </div>
  );
}

// ── Terminal scene ────────────────────────────────────────────────────────────

function TerminalScene() {
  return (
    <Sprite start={0} end={9.2}>
      {({ localTime, duration }) => {
        const fade = 0.4;
        const exitStart = duration - fade;
        let opacity = 1;
        if (localTime < fade) opacity = Easing.easeOutCubic(localTime / fade);
        else if (localTime > exitStart)
          opacity = 1 - Easing.easeInCubic((localTime - exitStart) / fade);

        return (
          <WindowFrame
            x={310}
            y={170}
            width={1300}
            height={740}
            title={
              <span>
                <span style={{ color: C.textFaint }}>~/checkout-flow $</span> seeflow
              </span>
            }
            badge="AI Agent"
            opacity={opacity}
          >
            <TerminalBody localTime={localTime} />
          </WindowFrame>
        );
      }}
    </Sprite>
  );
}

function TerminalBody({ localTime }: { localTime: number }) {
  const PROMPT_DELAY = 0.5;
  const PROMPT_DUR = 2.2;
  const PROMPT_END = PROMPT_DELAY + PROMPT_DUR;

  return (
    <div style={{ position: 'absolute', inset: 0, padding: '36px 44px' }}>
      <div style={{ position: 'relative' }}>
        <Line text="❯" x={0} y={0} color={C.emeraldHi} size={26} />
        <div style={{ position: 'absolute', left: 34, top: 0 }}>
          <Typewriter
            text="/seeflow show me the checkout feature"
            x={0}
            y={0}
            size={26}
            color={C.text}
            delay={PROMPT_DELAY}
            duration={PROMPT_DUR}
            caret={localTime < PROMPT_END + 0.3}
          />
        </div>
      </div>
      {localTime > PROMPT_END + 0.4 && <ResponseLog localTime={localTime - (PROMPT_END + 0.4)} />}
    </div>
  );
}

function ResponseLog({ localTime }: { localTime: number }) {
  const lines = [
    { delay: 0.0, text: 'Analyzing codebase…', color: C.textDim, prefix: '·' },
    {
      delay: 0.55,
      text: 'Found 3 services: API Gateway, Payment, Inventory DB.',
      color: C.textMute,
      prefix: '·',
    },
    { delay: 1.25, text: 'Generating seeflow.json…', color: C.textDim, prefix: '·' },
    { delay: 1.85, text: 'Wiring demo scripts…', color: C.textDim, prefix: '·' },
  ];

  return (
    <div style={{ position: 'absolute', top: 64, left: 34 }}>
      {lines.map((l, i) => {
        const t = localTime - l.delay;
        if (t < 0) return null;
        const opacity = Math.min(1, t / 0.3);
        const ty = (1 - Math.min(1, t / 0.3)) * 8;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static animation log lines
          <div
            key={i}
            style={{
              position: 'absolute',
              top: i * 44,
              left: 0,
              opacity,
              transform: `translateY(${ty}px)`,
              fontFamily: FONT_MONO,
              fontSize: 22,
              color: l.color,
              whiteSpace: 'pre',
            }}
          >
            <span style={{ color: C.textFaint, marginRight: 14 }}>{l.prefix}</span>
            {l.text}
          </div>
        );
      })}

      {localTime > 2.6 &&
        (() => {
          const t = localTime - 2.6;
          const o = Math.min(1, t / 0.35);
          return (
            <div
              style={{
                position: 'absolute',
                top: 4 * 44 + 16,
                left: 0,
                opacity: o,
                transform: `translateY(${(1 - o) * 8}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontFamily: FONT_MONO,
                fontSize: 24,
                color: C.text,
                whiteSpace: 'nowrap',
              }}
            >
              <CheckIcon size={22} color={C.emeraldHi} />
              <span>
                Done — canvas ready at <span style={{ color: C.emeraldHi }}>localhost:4321</span>
              </span>
            </div>
          );
        })()}

      {localTime > 3.2 &&
        (() => {
          const t = localTime - 3.2;
          const o = Math.min(1, t / 0.4);
          return (
            <div
              style={{
                position: 'absolute',
                top: 4 * 44 + 80,
                left: 0,
                opacity: o,
                transform: `translateY(${(1 - o) * 12}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: 'rgba(24,24,27,0.7)',
                fontFamily: FONT_MONO,
                fontSize: 20,
                color: C.textMute,
                whiteSpace: 'nowrap',
              }}
            >
              <FileIcon size={18} color={C.emeraldHi} />
              <span style={{ color: C.text }}>seeflow.json</span>
              <span style={{ color: C.textFaint }}>·</span>
              <span>9 nodes</span>
              <span style={{ color: C.textFaint }}>·</span>
              <span>11 edges</span>
            </div>
          );
        })()}
    </div>
  );
}

function CheckIcon({ size = 18, color = C.emeraldHi }: { size?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.8 10A10 10 0 1 1 17 3.3" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function FileIcon({ size = 18, color = C.emeraldHi }: { size?: number; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

// ── Canvas scene ──────────────────────────────────────────────────────────────

type NodeId = 'client' | 'gateway' | 'auth' | 'payment' | 'cart' | 'db' | 'notify';

interface NodeDef {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'shape' | 'play' | 'service' | 'db';
  t: number;
}

const NODES: Record<NodeId, NodeDef> = {
  client: {
    id: 'client',
    label: 'Customer',
    sub: 'web client',
    x: 100,
    y: 320,
    w: 200,
    h: 120,
    kind: 'shape',
    t: 1.0,
  },
  gateway: {
    id: 'gateway',
    label: 'API Gateway',
    sub: 'POST /checkout',
    x: 410,
    y: 320,
    w: 260,
    h: 120,
    kind: 'play',
    t: 1.8,
  },
  auth: {
    id: 'auth',
    label: 'Auth Service',
    sub: 'JWT · OAuth2',
    x: 780,
    y: 100,
    w: 260,
    h: 110,
    kind: 'service',
    t: 2.4,
  },
  payment: {
    id: 'payment',
    label: 'Payment',
    sub: 'Stripe API',
    x: 780,
    y: 320,
    w: 260,
    h: 120,
    kind: 'service',
    t: 2.8,
  },
  cart: {
    id: 'cart',
    label: 'Cart Service',
    sub: 'state · coupons',
    x: 780,
    y: 540,
    w: 260,
    h: 110,
    kind: 'service',
    t: 3.2,
  },
  db: {
    id: 'db',
    label: 'Inventory DB',
    sub: 'PostgreSQL',
    x: 1170,
    y: 220,
    w: 230,
    h: 130,
    kind: 'db',
    t: 3.6,
  },
  notify: {
    id: 'notify',
    label: 'Notify',
    sub: 'SES · SNS',
    x: 1170,
    y: 440,
    w: 230,
    h: 110,
    kind: 'service',
    t: 4.0,
  },
};

interface EdgeDef {
  from: NodeId;
  to: NodeId;
  t: number;
  label?: string;
}

const EDGES: EdgeDef[] = [
  { from: 'client', to: 'gateway', t: 4.4, label: 'HTTP' },
  { from: 'gateway', to: 'auth', t: 4.7 },
  { from: 'gateway', to: 'payment', t: 5.0, label: 'POST /pay' },
  { from: 'gateway', to: 'cart', t: 5.3 },
  { from: 'payment', to: 'db', t: 5.6, label: 'write' },
  { from: 'cart', to: 'db', t: 5.9 },
  { from: 'payment', to: 'notify', t: 6.2, label: 'event' },
];

const CLICK_T = 6.5;
const PLAY_T = 7.0;
const FLY1_T = 7.2;
const FLY2_T = 7.9;
const FLY3_T = 8.4;
const FLY4_T = 8.9;
const FLY5_T = 9.3;
const INSPECT_CLICK_T = 10.7;
const INSPECT_END_T = 17.2;

function edgePath(a: NodeDef, b: NodeDef) {
  const ax = a.x + a.w;
  const ay = a.y + a.h / 2;
  const bx = b.x;
  const by = b.y + b.h / 2;
  const midX = (ax + bx) / 2;
  const d = `M ${ax} ${ay} C ${midX} ${ay}, ${midX} ${by}, ${bx} ${by}`;
  const len = Math.hypot(bx - ax, by - ay) * 1.15 + 60;
  return { d, len, midX: (ax + bx) / 2, midY: (ay + by) / 2 };
}

type NodeState = 'idle' | 'pending' | 'ok';

function nodeStateFor(id: string, lt: number): NodeState {
  if (id === 'gateway') {
    if (lt > PLAY_T && lt < FLY1_T + 0.6) return 'pending';
    if (lt > FLY1_T + 0.6) return 'ok';
  }
  if (id === 'payment') {
    if (lt > FLY1_T + 0.5 && lt < FLY2_T + 0.5) return 'pending';
    if (lt > FLY2_T + 0.5) return 'ok';
  }
  if (id === 'db') {
    if (lt > FLY2_T + 0.5 && lt < FLY2_T + 1.0) return 'pending';
    if (lt > FLY2_T + 1.0) return 'ok';
  }
  if (id === 'notify') {
    if (lt > FLY3_T + 0.5) return 'ok';
  }
  if (id === 'cart') {
    if (lt > FLY4_T + 0.5 && lt < FLY5_T + 0.5) return 'pending';
    if (lt > FLY5_T + 0.5) return 'ok';
  }
  return 'idle';
}

function nodeSelectedFor(id: string, lt: number) {
  return id === 'payment' && lt > INSPECT_CLICK_T - 0.05 && lt < INSPECT_END_T + 0.4;
}

function CanvasScene() {
  return (
    <Sprite start={8.8} end={26.8}>
      {({ localTime, duration }) => {
        const fadeIn = 0.4;
        const fadeOut = 0.4;
        const exitStart = duration - fadeOut;
        let opacity = 1;
        let scale = 1;
        if (localTime < fadeIn) {
          const t = Easing.easeOutCubic(localTime / fadeIn);
          opacity = t;
          scale = 0.97 + 0.03 * t;
        } else if (localTime > exitStart) {
          const t = Easing.easeInCubic((localTime - exitStart) / fadeOut);
          opacity = 1 - t;
          scale = 1 + 0.02 * t;
        }
        return (
          <WindowFrame
            x={160}
            y={120}
            width={1600}
            height={840}
            title={<span>checkout-flow.json</span>}
            badge="Live"
            opacity={opacity}
            scale={scale}
          >
            <CanvasBody localTime={localTime - 0.4} />
          </WindowFrame>
        );
      }}
    </Sprite>
  );
}

function CanvasBody({ localTime }: { localTime: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#0a0a0c',
        backgroundImage:
          'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),' +
          'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    >
      <svg
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <defs>
          <marker
            id="arr"
            markerWidth="10"
            markerHeight="10"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            orient="auto-start-reverse"
          >
            <polyline
              points="-3,-2 0,0 -3,2"
              fill="none"
              stroke={C.borderHi}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        {EDGES.map((e, i) => {
          const t = localTime - e.t;
          if (t < 0) return null;
          const draw = Math.min(1, t / 0.5);
          const p = edgePath(NODES[e.from], NODES[e.to]);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static edge list
            <path
              key={i}
              d={p.d}
              fill="none"
              stroke={C.borderHi}
              strokeWidth="2"
              strokeDasharray={p.len}
              strokeDashoffset={p.len * (1 - draw)}
              markerEnd="url(#arr)"
              style={{ opacity: 0.7 }}
            />
          );
        })}
        <PacketFlow localTime={localTime} />
      </svg>

      {Object.values(NODES).map((n) => {
        const t = localTime - n.t;
        if (t < -0.05) return null;
        const o = Math.min(1, Math.max(0, t / 0.35));
        const s = 0.85 + 0.15 * Easing.easeOutBack(Math.min(1, Math.max(0, t / 0.35)));
        const state = nodeStateFor(n.id, localTime);
        const selected = nodeSelectedFor(n.id, localTime);
        return (
          <NodeCard key={n.id} node={n} opacity={o} scale={s} state={state} selected={selected} />
        );
      })}

      <LiveCursor localTime={localTime} />

      {EDGES.filter((e) => e.label).map((e, i) => {
        const t = localTime - e.t - 0.4;
        if (t < 0) return null;
        const o = Math.min(1, t / 0.3);
        const p = edgePath(NODES[e.from], NODES[e.to]);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static edge label list
          <div
            key={i}
            style={{
              position: 'absolute',
              left: p.midX,
              top: p.midY,
              transform: 'translate(-50%,-50%)',
              opacity: o,
              padding: '2px 6px',
              background: 'rgba(9,9,11,0.85)',
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.textMute,
            }}
          >
            {e.label}
          </div>
        );
      })}

      <NodeDetailSidebar localTime={localTime} />
    </div>
  );
}

function NodeCard({
  node,
  opacity,
  scale,
  state,
  selected,
}: {
  node: NodeDef;
  opacity: number;
  scale: number;
  state: NodeState;
  selected: boolean;
}) {
  const isPlay = node.kind === 'play';

  const borderColor = selected
    ? C.emeraldHi
    : state === 'pending'
      ? C.amber
      : state === 'ok'
        ? C.emerald
        : C.border;
  const glow = selected
    ? '0 0 0 3px rgba(16,185,129,0.22), 0 0 40px -6px rgba(16,185,129,0.55)'
    : state === 'pending'
      ? '0 0 30px -4px rgba(245,158,11,0.45)'
      : state === 'ok'
        ? '0 0 30px -4px rgba(16,185,129,0.45)'
        : '0 4px 12px -2px rgba(0,0,0,0.5)';

  return (
    <div
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        background: C.surface,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        boxShadow: glow,
        fontFamily: FONT_SANS,
        transition: 'border-color 250ms ease, box-shadow 250ms ease',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.textMute,
            }}
          >
            <NodeIcon kind={node.kind} state={state} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 18, color: C.text, letterSpacing: '-0.01em' }}>
            {node.label}
          </div>
        </div>
        {isPlay && (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              border: `1.5px solid ${state === 'ok' ? C.emerald : C.borderHi}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: state === 'ok' ? C.emeraldHi : C.textMute,
            }}
          >
            {state === 'pending' ? (
              <Spinner size={12} />
            ) : (
              <svg
                aria-hidden="true"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="6,4 20,12 6,20" />
              </svg>
            )}
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.textDim }}>{node.sub}</div>
      {state === 'ok' && (
        <div
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.3)',
            color: C.emeraldHi,
            fontFamily: FONT_MONO,
            fontSize: 12,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, background: C.emeraldHi }} />
          200 OK
        </div>
      )}
      {state === 'pending' && (
        <div
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            alignItems: 'center',
            gap: 6,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.3)',
            color: C.amberHi,
            fontFamily: FONT_MONO,
            fontSize: 12,
          }}
        >
          <Spinner size={10} />
          Processing…
        </div>
      )}
    </div>
  );
}

function NodeIcon({ kind, state }: { kind: string; state: NodeState }) {
  const c = state === 'ok' ? C.emeraldHi : state === 'pending' ? C.amberHi : C.textMute;
  if (kind === 'shape')
    return (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
      </svg>
    );
  if (kind === 'db')
    return (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    );
  if (kind === 'play')
    return (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="8" rx="2" />
        <rect x="2" y="13" width="20" height="8" rx="2" />
        <path d="M6 7h.01M6 17h.01" />
      </svg>
    );
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}

function Spinner({ size = 12, color = C.amberHi }: { size?: number; color?: string }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `1.6px solid ${color}33`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'sf-spin 0.8s linear infinite',
        display: 'inline-block',
      }}
    />
  );
}

function PacketFlow({ localTime }: { localTime: number }) {
  const packets: Array<{ from: NodeId; to: NodeId; t: number; color: string }> = [
    { from: 'gateway', to: 'payment', t: FLY1_T, color: C.emeraldHi },
    { from: 'payment', to: 'db', t: FLY2_T, color: C.emeraldHi },
    { from: 'payment', to: 'notify', t: FLY3_T, color: C.emeraldHi },
    { from: 'gateway', to: 'cart', t: FLY4_T, color: C.emeraldHi },
    { from: 'cart', to: 'db', t: FLY5_T, color: C.emeraldHi },
  ];
  const DUR = 0.55;

  return (
    <g>
      {packets.map((pk, i) => {
        const t = (localTime - pk.t) / DUR;
        if (t < 0 || t > 1.05) return null;
        const tt = Easing.easeInOutCubic(Math.min(1, Math.max(0, t)));
        const a = NODES[pk.from];
        const b = NODES[pk.to];
        const ax = a.x + a.w;
        const ay = a.y + a.h / 2;
        const bx = b.x;
        const by = b.y + b.h / 2;
        const midX = (ax + bx) / 2;
        const p = bezierPoint(ax, ay, midX, ay, midX, by, bx, by, tt);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: static packet list
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="6"
              fill={pk.color}
              style={{ filter: `drop-shadow(0 0 8px ${pk.color})` }}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r="14"
              fill="none"
              stroke={pk.color}
              strokeOpacity={1 - t}
              strokeWidth="1.5"
            />
          </g>
        );
      })}
    </g>
  );
}

function bezierPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
    y: mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
  };
}

function LiveCursor({ localTime }: { localTime: number }) {
  const gw = NODES.gateway;
  const pay = NODES.payment;
  const gwTargetX = gw.x + gw.w - 50;
  const gwTargetY = gw.y + 28;

  if (localTime < 5.4 || localTime > INSPECT_CLICK_T + 0.9) return null;

  let x: number;
  let y: number;
  let clickT = -10;

  if (localTime < 7.8) {
    const startX = 240;
    const startY = 660;
    const t = clamp((localTime - 5.4) / 1.2, 0, 1);
    const e = Easing.easeInOutCubic(t);
    x = lerp(startX, gwTargetX, e);
    y = lerp(startY, gwTargetY, e);
    clickT = localTime - PLAY_T;
  } else if (localTime < 9.6) {
    x = gwTargetX;
    y = gwTargetY;
  } else {
    const payX = pay.x + pay.w / 2;
    const payY = pay.y + pay.h / 2;
    const t = clamp((localTime - 9.6) / 1.1, 0, 1);
    const e = Easing.easeInOutCubic(t);
    x = lerp(gwTargetX, payX, e);
    y = lerp(gwTargetY, payY, e);
    clickT = localTime - INSPECT_CLICK_T;
  }

  const showPulse = clickT > -0.05 && clickT < 0.6;
  const pulseScale = showPulse ? 1 + Easing.easeOutCubic(Math.max(0, clickT / 0.4)) * 2.2 : 0;
  const pulseOpacity = showPulse ? 1 - Math.max(0, clickT / 0.55) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        zIndex: 30,
        transform: 'translate(-2px, -2px)',
      }}
    >
      {showPulse && (
        <div
          style={{
            position: 'absolute',
            left: -22,
            top: -22,
            width: 44,
            height: 44,
            borderRadius: 22,
            border: `2px solid ${C.emeraldHi}`,
            opacity: pulseOpacity,
            transform: `scale(${pulseScale})`,
          }}
        />
      )}
      <svg
        aria-hidden="true"
        width="22"
        height="26"
        viewBox="0 0 22 26"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))' }}
      >
        <path
          d="M1 1 L1 19 L6 14 L9 22 L12 21 L9 13 L16 13 Z"
          fill={C.text}
          stroke="#000"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

function NodeDetailSidebar({ localTime }: { localTime: number }) {
  if (localTime < INSPECT_CLICK_T - 0.05 || localTime > INSPECT_END_T + 0.5) return null;

  const inT = clamp((localTime - INSPECT_CLICK_T) / 0.5, 0, 1);
  const eIn = Easing.easeOutCubic(inT);
  const outT = clamp((localTime - INSPECT_END_T) / 0.4, 0, 1);
  const eOut = Easing.easeInCubic(outT);
  const tx = (1 - eIn) * 420 + eOut * 420;
  const opacity = inT * (1 - eOut);

  const contentStart = INSPECT_CLICK_T + 0.35;
  const reveal = (delay: number) => {
    const tt = clamp((localTime - contentStart - delay) / 0.4, 0, 1);
    return { opacity: Easing.easeOutCubic(tt), ty: (1 - Easing.easeOutCubic(tt)) * 8 };
  };

  const activity = [
    { ts: 'just now', status: 200, ms: 142 },
    { ts: '12s ago', status: 200, ms: 98 },
    { ts: '48s ago', status: 200, ms: 156 },
    { ts: '2m ago', status: 402, ms: 87 },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 400,
        transform: `translateX(${tx}px)`,
        opacity,
        background: 'rgba(9,9,11,0.94)',
        backdropFilter: 'blur(14px)',
        borderLeft: `1px solid ${C.border}`,
        padding: '28px 26px',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        fontFamily: FONT_SANS,
        color: C.text,
        boxShadow: '-12px 0 40px -12px rgba(0,0,0,0.6)',
        zIndex: 25,
        overflow: 'hidden',
      }}
    >
      {(() => {
        const r = reveal(0);
        return (
          <div style={{ opacity: r.opacity, transform: `translateY(${r.ty}px)` }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.textDim,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Node detail
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: 'rgba(255,255,255,0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: C.emeraldHi,
                }}
              >
                <NodeIcon kind="service" state="ok" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 22, letterSpacing: '-0.02em' }}>
                  Payment
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.textDim }}>
                  Stripe API · service
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {(() => {
        const r = reveal(0.15);
        return (
          <div
            style={{
              opacity: r.opacity,
              transform: `translateY(${r.ty}px)`,
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 4,
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.3)',
                color: C.emeraldHi,
                fontFamily: FONT_MONO,
                fontSize: 13,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 3, background: C.emeraldHi }} />
              200 OK
            </span>
            <span
              style={{
                padding: '5px 10px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`,
                color: C.textMute,
                fontFamily: FONT_MONO,
                fontSize: 13,
              }}
            >
              142 ms
            </span>
          </div>
        );
      })()}

      {(() => {
        const r = reveal(0.3);
        return (
          <div style={{ opacity: r.opacity, transform: `translateY(${r.ty}px)` }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.textDim,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Endpoint
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${C.border}`,
                fontFamily: FONT_MONO,
                fontSize: 14,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: 3,
                  background: 'rgba(16,185,129,0.15)',
                  color: C.emeraldHi,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                POST
              </span>
              <span style={{ color: C.text }}>/payment/charge</span>
            </div>
          </div>
        );
      })()}

      {(() => {
        const r = reveal(0.45);
        return (
          <div
            style={{
              opacity: r.opacity,
              transform: `translateY(${r.ty}px)`,
              flex: 1,
              minHeight: 0,
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.textDim,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Recent activity
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activity.map((a, i) => {
                const ar = reveal(0.55 + i * 0.08);
                const ok = a.status < 400;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static activity list
                  <div
                    key={i}
                    style={{
                      opacity: ar.opacity,
                      transform: `translateY(${ar.ty}px)`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.02)',
                      border: `1px solid ${C.border}`,
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        background: ok ? C.emeraldHi : '#ef4444',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: C.text, fontWeight: 600, width: 30 }}>{a.status}</span>
                    <span style={{ color: C.textDim, width: 50 }}>{a.ms}ms</span>
                    <span style={{ color: C.textFaint, fontSize: 12, marginLeft: 'auto' }}>
                      {a.ts}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── End card ──────────────────────────────────────────────────────────────────

function EndCard() {
  return (
    <Sprite start={26.6} end={30.0}>
      {({ localTime, duration }) => {
        const fadeIn = 0.5;
        const fadeOut = 0.4;
        const exitStart = duration - fadeOut;
        let opacity = 1;
        if (localTime < fadeIn) opacity = Easing.easeOutCubic(localTime / fadeIn);
        else if (localTime > exitStart)
          opacity = 1 - Easing.easeInCubic((localTime - exitStart) / fadeOut);

        const cmdReveal = clamp((localTime - 0.6) / 0.7, 0, 1);
        const taglineReveal = clamp((localTime - 1.0) / 0.6, 0, 1);

        return (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              opacity,
              gap: 36,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                fontFamily: FONT_SANS,
                fontWeight: 600,
                fontSize: 96,
                color: C.text,
                letterSpacing: '-0.04em',
              }}
            >
              <svg
                aria-hidden="true"
                width="84"
                height="84"
                viewBox="0 0 24 24"
                fill="none"
                stroke={C.emeraldHi}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="8" height="8" x="3" y="3" rx="2" />
                <path d="M7 11v4a2 2 0 0 0 2 2h4" />
                <rect width="8" height="8" x="13" y="13" rx="2" />
              </svg>
              SeeFlow
            </div>
            <div
              style={{
                opacity: taglineReveal,
                transform: `translateY(${(1 - taglineReveal) * 12}px)`,
                fontFamily: FONT_SANS,
                fontSize: 32,
                fontWeight: 400,
                color: C.textMute,
                letterSpacing: '-0.01em',
              }}
            >
              Architecture diagrams that actually run.
            </div>
            <div
              style={{
                opacity: cmdReveal,
                transform: `translateY(${(1 - cmdReveal) * 8}px)`,
                marginTop: 24,
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '16px 28px',
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: 'rgba(24,24,27,0.7)',
                fontFamily: FONT_MONO,
                fontSize: 26,
                color: C.text,
              }}
            >
              <span style={{ color: C.emeraldHi }}>$</span>
              <span>npx tuongaz/seeflow start</span>
            </div>
          </div>
        );
      }}
    </Sprite>
  );
}

// ── Persistent chrome ─────────────────────────────────────────────────────────

function PersistentChrome() {
  const t = useTime();
  const showChrome = t < 26.4;
  const o = showChrome ? (t < 0.3 ? t / 0.3 : t > 26.1 ? Math.max(0, 1 - (t - 26.1) / 0.3) : 1) : 0;

  const phase =
    t < 4.0
      ? '01 / prompt'
      : t < 9.0
        ? '02 / generate'
        : t < 13.0
          ? '03 / wire'
          : t < 19.0
            ? '04 / run'
            : t < 26.4
              ? '05 / inspect'
              : '';

  return (
    <>
      <Wordmark x={56} y={48} size={26} opacity={o} />
      {phase && (
        <div
          style={{
            position: 'absolute',
            right: 56,
            top: 56,
            opacity: o,
            fontFamily: FONT_MONO,
            fontSize: 14,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: C.textDim,
          }}
        >
          {phase}
        </div>
      )}
    </>
  );
}

// ── Hero animation export ─────────────────────────────────────────────────────

export function HeroAnimation() {
  return (
    <Stage
      width={1920}
      height={1080}
      duration={30}
      background={C.bg}
      persistKey="seeflow-hero"
      showControls={false}
    >
      <GridBackdrop />
      <TerminalScene />
      <CanvasScene />
      <EndCard />
    </Stage>
  );
}
