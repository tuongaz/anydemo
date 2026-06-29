import { type Operations, createOperations } from './operations.ts';
import { type ScanError, scanProject } from './project-scanner.ts';
import {
  type FlowEntry,
  type Registry,
  createRegistry,
  manifestOnlyEntryFilter,
} from './registry.ts';

/**
 * Build a single Operations handle for in-process CLI use.
 *
 * The CLI has no watcher. When a CLI mutates a flow file, the
 * running studio's flow watcher picks up the disk write externally and
 * broadcasts flow:reload to connected SPA clients.
 *
 * `OperationsDeps` doesn't currently carry an EventBus, so we don't pass one;
 * the *Impl functions only broadcast through `watcher.broadcastReload`, which
 * is undefined in the CLI.
 */
export function createCliOperations(): Operations {
  return createOperations({
    registry: createRegistry({ isLoadableEntry: manifestOnlyEntryFilter }),
  });
}

export interface RegisterProjectOpts {
  /** Absolute (or relative) path of the project root that contains a
   *  `seeflow.json` manifest plus one `flows/<id>/flow.json` per declared flow. */
  repoPath: string;
  /** Registry handle to upsert into. Defaults to a fresh `createRegistry()` —
   *  long-lived consumers (the server's seed path, the in-process CLI ops)
   *  should pass their own to share state across calls. */
  registry?: Registry;
}

export type RegisterProjectOutcome =
  | { kind: 'ok'; projectSlug: string; entries: FlowEntry[] }
  | ScanError;

/**
 * Scan a project root and register every flow declared in its `seeflow.json`.
 * Produces one `FlowEntry` per `ScannedFlow` — `projectSlug` is shared across
 * the resulting entries, `flowSlug` mirrors the manifest entry id, and the
 * entry whose id matches `manifest.defaultFlow` is marked `isDefault: true`.
 *
 * The legacy single-flow `ops.registerFlow` path in operations.ts still backs
 * the `/api/flows/register` HTTP endpoint until US-007 rewrites the route
 * tree. `registerProject` is the manifest-driven replacement the CLI uses
 * from US-004 onward.
 */
export function registerProject(opts: RegisterProjectOpts): RegisterProjectOutcome {
  const registry = opts.registry ?? createRegistry({ isLoadableEntry: manifestOnlyEntryFilter });
  const scan = scanProject(opts.repoPath);
  if (scan.kind !== 'ok') return scan;

  const entries: FlowEntry[] = scan.flows.map((flow) =>
    registry.upsert({
      name: flow.name,
      description: scan.manifest.description,
      repoPath: opts.repoPath,
      flowPath: flow.flowPath,
      projectSlug: scan.projectSlug,
      flowSlug: flow.id,
      isDefault: flow.isDefault,
      icon: flow.icon,
    }),
  );

  return { kind: 'ok', projectSlug: scan.projectSlug, entries };
}
