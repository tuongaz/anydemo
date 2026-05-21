import { type Operations, createOperations } from './operations.ts';
import { createRegistry } from './registry.ts';

/**
 * Build a single Operations handle for in-process CLI use.
 *
 * The CLI has no watcher and no statusRunner — play/reset are server-only
 * features that still go via HTTP. When a CLI mutates a flow file, the
 * running studio's flow watcher picks up the disk write externally and
 * broadcasts flow:reload to connected SPA clients.
 *
 * `OperationsDeps` doesn't currently carry an EventBus, so we don't pass one;
 * the *Impl functions only broadcast through `watcher.broadcastReload`, which
 * is undefined in the CLI.
 */
export function createCliOperations(): Operations {
  return createOperations({ registry: createRegistry() });
}
