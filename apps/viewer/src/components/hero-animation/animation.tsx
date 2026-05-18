import React from 'react';

// ── Easing functions ─────────────────────────────────────────────────────────
export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => {
    const u = t - 1;
    return u * u * u + 1;
  },
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  easeInBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeInExpo: (t: number) => (t === 0 ? 0 : 2 ** (10 * (t - 1))),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeOutSine: (t: number) => Math.sin((t * Math.PI) / 2),
  easeInSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
};

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function interpolate(
  input: number[],
  output: number[],
  ease: ((t: number) => number) | ((t: number) => number)[] = Easing.linear,
) {
  return (t: number): number => {
    const first = input[0] ?? 0;
    const last = input[input.length - 1] ?? 0;
    if (t <= first) return output[0] ?? 0;
    if (t >= last) return output[output.length - 1] ?? 0;
    for (let i = 0; i < input.length - 1; i++) {
      const lo = input[i] ?? 0;
      const hi = input[i + 1] ?? 0;
      if (t >= lo && t <= hi) {
        const span = hi - lo;
        const local = span === 0 ? 0 : (t - lo) / span;
        const easeFn = Array.isArray(ease) ? (ease[i] ?? Easing.linear) : ease;
        const eased = easeFn(local);
        const outLo = output[i] ?? 0;
        const outHi = output[i + 1] ?? 0;
        return outLo + (outHi - outLo) * eased;
      }
    }
    return output[output.length - 1] ?? 0;
  };
}

export function animate({
  from = 0,
  to = 1,
  start = 0,
  end = 1,
  ease = Easing.easeInOutCubic,
}: {
  from?: number;
  to?: number;
  start?: number;
  end?: number;
  ease?: (t: number) => number;
}) {
  return (t: number) => {
    if (t <= start) return from;
    if (t >= end) return to;
    const local = (t - start) / (end - start);
    return from + (to - from) * ease(local);
  };
}

// ── Timeline context ──────────────────────────────────────────────────────────

interface TimelineContextValue {
  time: number;
  duration: number;
  playing: boolean;
  setTime: (t: number) => void;
  setPlaying: (p: boolean | ((prev: boolean) => boolean)) => void;
}

export const TimelineContext = React.createContext<TimelineContextValue>({
  time: 0,
  duration: 10,
  playing: false,
  setTime: () => {},
  setPlaying: () => {},
});

export const useTime = () => React.useContext(TimelineContext).time;
export const useTimeline = () => React.useContext(TimelineContext);

// ── Sprite ────────────────────────────────────────────────────────────────────

interface SpriteContextValue {
  localTime: number;
  progress: number;
  duration: number;
  visible: boolean;
}

export const SpriteContext = React.createContext<SpriteContextValue>({
  localTime: 0,
  progress: 0,
  duration: 0,
  visible: false,
});

export const useSprite = () => React.useContext(SpriteContext);

interface SpriteProps {
  start?: number;
  end?: number;
  keepMounted?: boolean;
  children?: React.ReactNode | ((props: SpriteContextValue) => React.ReactNode);
}

export function Sprite({
  start = 0,
  end = Number.POSITIVE_INFINITY,
  children,
  keepMounted = false,
}: SpriteProps) {
  const { time } = useTimeline();
  const visible = time >= start && time <= end;
  if (!visible && !keepMounted) return null;

  const duration = end - start;
  const localTime = Math.max(0, time - start);
  const progress =
    duration > 0 && Number.isFinite(duration) ? clamp(localTime / duration, 0, 1) : 0;

  const value: SpriteContextValue = { localTime, progress, duration, visible };

  return (
    <SpriteContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </SpriteContext.Provider>
  );
}

// ── Stage ─────────────────────────────────────────────────────────────────────

interface StageProps {
  width?: number;
  height?: number;
  duration?: number;
  background?: string;
  loop?: boolean;
  autoplay?: boolean;
  persistKey?: string;
  showControls?: boolean;
  children?: React.ReactNode;
}

export function Stage({
  width = 1280,
  height = 720,
  duration = 10,
  background = '#f6f4ef',
  loop = true,
  autoplay = true,
  persistKey = 'animstage',
  showControls = true,
  children,
}: StageProps) {
  const [time, setTime] = React.useState(() => {
    try {
      const v = Number.parseFloat(localStorage.getItem(`${persistKey}:t`) || '0');
      return Number.isFinite(v) ? clamp(v, 0, duration) : 0;
    } catch {
      return 0;
    }
  });
  const [playing, setPlaying] = React.useState(autoplay);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [scale, setScale] = React.useState(1);

  const stageRef = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number | null>(null);
  const lastTsRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    try {
      localStorage.setItem(`${persistKey}:t`, String(time));
    } catch {}
  }, [time, persistKey]);

  React.useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const measure = () => {
      const barH = showControls ? 44 : 0;
      const s = Math.min(el.clientWidth / width, (el.clientHeight - barH) / height);
      setScale(Math.max(0.05, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [width, height, showControls]);

  React.useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= duration) {
          if (loop) next = next % duration;
          else {
            next = duration;
            setPlaying(false);
          }
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [playing, duration, loop]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        setTime((t) => clamp(t - (e.shiftKey ? 1 : 0.1), 0, duration));
      } else if (e.code === 'ArrowRight') {
        setTime((t) => clamp(t + (e.shiftKey ? 1 : 0.1), 0, duration));
      } else if (e.key === '0' || e.code === 'Home') {
        setTime(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration]);

  const displayTime = hoverTime != null ? hoverTime : time;

  const ctxValue = React.useMemo(
    () => ({ time: displayTime, duration, playing, setTime, setPlaying }),
    [displayTime, duration, playing],
  );

  return (
    <div
      ref={stageRef}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: '#0a0a0a',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          flex: 1,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <div
          style={{
            width,
            height,
            background,
            position: 'relative',
            transform: `scale(${scale})`,
            transformOrigin: 'center',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <TimelineContext.Provider value={ctxValue}>{children}</TimelineContext.Provider>
        </div>
      </div>

      {showControls && (
        <PlaybackBar
          time={displayTime}
          duration={duration}
          playing={playing}
          onPlayPause={() => setPlaying((p) => !p)}
          onReset={() => setTime(0)}
          onSeek={(t) => setTime(t)}
          onHover={(t) => setHoverTime(t)}
        />
      )}
    </div>
  );
}

// ── PlaybackBar ───────────────────────────────────────────────────────────────

interface PlaybackBarProps {
  time: number;
  duration: number;
  playing: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (t: number) => void;
  onHover: (t: number | null) => void;
}

export function PlaybackBar({
  time,
  duration,
  playing,
  onPlayPause,
  onReset,
  onSeek,
  onHover,
}: PlaybackBarProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const timeFromEvent = React.useCallback(
    (e: MouseEvent) => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      return x * duration;
    },
    [duration],
  );

  const onTrackMove = (e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const t = x * duration;
    if (dragging) onSeek(t);
    else onHover(t);
  };

  const onTrackLeave = () => {
    if (!dragging) onHover(null);
  };

  const onTrackDown = (e: React.MouseEvent) => {
    setDragging(true);
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    onSeek(x * duration);
    onHover(null);
  };

  React.useEffect(() => {
    if (!dragging) return;
    const onUp = () => setDragging(false);
    const onMove = (e: MouseEvent) => {
      onSeek(timeFromEvent(e));
    };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
    };
  }, [dragging, timeFromEvent, onSeek]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const fmt = (t: number) => {
    const total = Math.max(0, t);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const cs = Math.floor((total * 100) % 100);
    return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const mono = 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: 'rgba(20,20,20,0.92)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        width: '100%',
        maxWidth: 680,
        alignSelf: 'center',
        borderRadius: 8,
        color: '#f6f4ef',
        fontFamily: 'Inter, system-ui, sans-serif',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <IconButton onClick={onReset} title="Return to start">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 2v10M12 2L5 7l7 5V2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </IconButton>
      <IconButton onClick={onPlayPause} title="Play/pause (space)">
        {playing ? (
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="3" y="2" width="3" height="10" fill="currentColor" />
            <rect x="8" y="2" width="3" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2l9 5-9 5V2z" fill="currentColor" />
          </svg>
        )}
      </IconButton>

      <div
        style={{
          fontFamily: mono,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          width: 64,
          textAlign: 'right',
          color: '#f6f4ef',
        }}
      >
        {fmt(time)}
      </div>

      <div
        ref={trackRef}
        onMouseMove={onTrackMove}
        onMouseLeave={onTrackLeave}
        onMouseDown={onTrackDown}
        style={{
          flex: 1,
          height: 22,
          position: 'relative',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 4,
            background: 'rgba(255,255,255,0.12)',
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${pct}%`,
            height: 4,
            background: 'oklch(72% 0.12 250)',
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${pct}%`,
            top: '50%',
            width: 12,
            height: 12,
            marginLeft: -6,
            marginTop: -6,
            background: '#fff',
            borderRadius: 6,
            boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
          }}
        />
      </div>

      <div
        style={{
          fontFamily: mono,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          width: 64,
          textAlign: 'left',
          color: 'rgba(246,244,239,0.55)',
        }}
      >
        {fmt(duration)}
      </div>
    </div>
  );
}

interface IconButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}

export function IconButton({ children, onClick, title }: IconButtonProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hover ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        color: '#f6f4ef',
        cursor: 'pointer',
        padding: 0,
        transition: 'background 120ms',
      }}
    >
      {children}
    </button>
  );
}
