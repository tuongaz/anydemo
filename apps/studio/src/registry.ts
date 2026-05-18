import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seeflowHome } from './paths.ts';

export interface DemoEntry {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  demoPath: string;
  lastModified: number;
  valid: boolean;
}

export interface RegisterInput {
  name: string;
  repoPath: string;
  demoPath: string;
  valid?: boolean;
  lastModified?: number;
}

export interface Registry {
  list(): DemoEntry[];
  getById(id: string): DemoEntry | undefined;
  getBySlug(slug: string): DemoEntry | undefined;
  getByRepoPath(repoPath: string): DemoEntry | undefined;
  getByRepoPathAndDemoPath(repoPath: string, demoPath: string): DemoEntry | undefined;
  upsert(input: RegisterInput): DemoEntry;
  remove(id: string): boolean;
}

export function defaultRegistryPath(): string {
  return join(seeflowHome(), 'registry.json');
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'demo';
}

export function createRegistry(options: { path?: string } = {}): Registry {
  const path = options.path ?? defaultRegistryPath();
  const entries = new Map<string, DemoEntry>();

  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          if (
            e &&
            typeof e.id === 'string' &&
            typeof e.slug === 'string' &&
            typeof e.repoPath === 'string'
          ) {
            entries.set(e.id, e as DemoEntry);
          }
        }
      }
    } catch (err) {
      console.error(`[registry] failed to load ${path}, starting empty:`, err);
    }
  }

  const persist = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...entries.values()], null, 2));
  };

  const findByRepoPath = (repoPath: string): DemoEntry | undefined => {
    for (const e of entries.values()) {
      if (e.repoPath === repoPath) return e;
    }
    return undefined;
  };

  const findByRepoPathAndDemoPath = (repoPath: string, demoPath: string): DemoEntry | undefined => {
    for (const e of entries.values()) {
      if (e.repoPath === repoPath && e.demoPath === demoPath) return e;
    }
    return undefined;
  };

  const uniqueSlug = (base: string): string => {
    const taken = new Set([...entries.values()].map((e) => e.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  };

  return {
    list: () => [...entries.values()],
    getById: (id) => entries.get(id),
    getBySlug: (slug) => [...entries.values()].find((e) => e.slug === slug),
    getByRepoPath: findByRepoPath,
    getByRepoPathAndDemoPath: findByRepoPathAndDemoPath,
    upsert(input) {
      const lastModified = input.lastModified ?? Date.now();
      const valid = input.valid ?? true;
      const existing = findByRepoPathAndDemoPath(input.repoPath, input.demoPath);
      if (existing) {
        const updated: DemoEntry = {
          ...existing,
          name: input.name,
          demoPath: input.demoPath,
          lastModified,
          valid,
        };
        entries.set(existing.id, updated);
        persist();
        return updated;
      }
      const id = crypto.randomUUID();
      const slug = uniqueSlug(slugify(input.name));
      const entry: DemoEntry = {
        id,
        slug,
        name: input.name,
        repoPath: input.repoPath,
        demoPath: input.demoPath,
        lastModified,
        valid,
      };
      entries.set(id, entry);
      persist();
      return entry;
    },
    remove(id) {
      const removed = entries.delete(id);
      if (removed) persist();
      return removed;
    },
  };
}
