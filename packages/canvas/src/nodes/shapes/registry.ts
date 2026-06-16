import type { FC } from 'react';
import type { GeometricNodeType } from '../../types.ts';
import { CloudShape } from './cloud.tsx';
import { DatabaseShape } from './database.tsx';
import { DiamondShape } from './diamond.tsx';
import { DocumentShape } from './document.tsx';
import { HexagonShape } from './hexagon.tsx';
import { ParallelogramShape } from './parallelogram.tsx';
import { QueueShape } from './queue.tsx';
import { ServerShape } from './server.tsx';
import { TriangleShape } from './triangle.tsx';
import type { ShapePartProps } from './types.ts';
import { UserShape } from './user.tsx';

// US-022: single source of truth for illustrative-shape dispatch. Both
// `geometric-node.tsx` (the committed node) and the drag-create ghost in
// `seeflow-canvas.tsx` look the renderer up here, so adding a new illustrative
// shape only requires touching this map + the per-shape SVG file. The
// `isIllustrativeShape` predicate in geometric-node.tsx derives directly from
// `Object.keys(ILLUSTRATIVE_SHAPE_RENDERERS)`, keeping the chrome-suppression
// rule in lockstep with the dispatch set.
export const ILLUSTRATIVE_SHAPE_RENDERERS: Partial<Record<GeometricNodeType, FC<ShapePartProps>>> =
  {
    database: DatabaseShape,
    server: ServerShape,
    user: UserShape,
    queue: QueueShape,
    cloud: CloudShape,
    diamond: DiamondShape,
    hexagon: HexagonShape,
    triangle: TriangleShape,
    parallelogram: ParallelogramShape,
    document: DocumentShape,
  };
