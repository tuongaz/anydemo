const queues = new Map<string, Promise<unknown>>();

export async function withVendorLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(lockPath) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tracked = run.catch(() => undefined);
  queues.set(lockPath, tracked);
  try {
    return await run;
  } finally {
    if (queues.get(lockPath) === tracked) queues.delete(lockPath);
  }
}
