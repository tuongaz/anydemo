import type { FC } from 'react';
import type { ShapeKind } from '../../types.ts';
import { CloudShape } from './cloud.tsx';
import { DatabaseShape } from './database.tsx';
import { QueueShape } from './queue.tsx';
import { ServerShape } from './server.tsx';
import type { ShapePartProps } from './types.ts';
import { UserShape } from './user.tsx';

// US-022: single source of truth for illustrative-shape dispatch. Both
// `shape-node.tsx` (the committed node) and `demo-canvas.tsx` (the drag-create
// ghost) look the renderer up here, so adding a new illustrative shape only
// requires touching this map + the per-shape SVG file. The
// `isIllustrativeShape` predicate in shape-node.tsx derives directly from
// `Object.keys(ILLUSTRATIVE_SHAPE_RENDERERS)`, keeping the chrome-suppression
// rule in lockstep with the dispatch set.
export const ILLUSTRATIVE_SHAPE_RENDERERS: Partial<Record<ShapeKind, FC<ShapePartProps>>> = {
  database: DatabaseShape,
  server: ServerShape,
  user: UserShape,
  queue: QueueShape,
  cloud: CloudShape,
};
