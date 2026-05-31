import type { CSSProperties } from 'react';

export interface PeerCursor {
  peerId: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
  idle?: boolean;
}

export interface PeerCursorsLayerProps {
  peers: PeerCursor[];
  selfPeerId?: string;
}

const ARROW_SIZE = 14;
const TRANSITION = 'transform 80ms linear';

const wrapperStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
};

const pillBaseStyle: CSSProperties = {
  position: 'absolute',
  left: ARROW_SIZE - 2,
  top: ARROW_SIZE - 2,
  color: '#fff',
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
  lineHeight: 1,
  borderRadius: 4,
  padding: '4px 6px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

/**
 * Renders one positioned cursor (arrow + name pill) per remote peer.
 *
 * Mounted inside the React Flow viewport (via `presenceLayer`) so each peer's
 * `translate({x}px, {y}px)` lives in flow space — pan/zoom on the local viewer
 * keeps every remote cursor pinned to the world coordinate the originator
 * pointed at. `selfPeerId` is filtered out so the local user never sees their
 * own ghost. The wrapper sets `pointer-events: none` so the layer never eats
 * pane clicks; cursors inherit and stay non-interactive.
 *
 * The 80ms linear `transform` transition is the smoothing low-pass for the
 * ~30 fps cursor stream coming off the WebSocket — long enough to hide jitter
 * between frames, short enough that real motion stays responsive.
 */
export function PeerCursorsLayer({ peers, selfPeerId }: PeerCursorsLayerProps) {
  return (
    <div data-testid="peer-cursors-layer" style={wrapperStyle}>
      {peers
        .filter((p) => p.peerId !== selfPeerId)
        .map((peer) => {
          const opacity = peer.idle ? 0.4 : 1;
          return (
            <div
              key={peer.peerId}
              data-testid={`peer-cursor-${peer.peerId}`}
              data-peer-id={peer.peerId}
              data-idle={peer.idle ? 'true' : 'false'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translate(${peer.x}px, ${peer.y}px)`,
                transition: TRANSITION,
                opacity,
                pointerEvents: 'none',
              }}
            >
              <svg
                width={ARROW_SIZE}
                height={ARROW_SIZE}
                viewBox="0 0 14 14"
                fill={peer.color}
                aria-hidden="true"
                style={{
                  display: 'block',
                  filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
                }}
              >
                <path d="M1 1 L1 12 L4.2 9 L6.6 13 L8.3 12 L5.9 8 L10 8 Z" />
              </svg>
              <span style={{ ...pillBaseStyle, background: peer.color }}>{peer.displayName}</span>
            </div>
          );
        })}
    </div>
  );
}
