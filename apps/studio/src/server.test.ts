import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRegistry } from './registry.ts';
import { RUNTIME_ASSETS_DIR, createApp } from './server.ts';
import type { Spawner } from './shellout.ts';

describe('createApp', () => {
  it('GET /health returns { ok: true }', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown route returns 404', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web' });
    const res = await app.request('/__definitely_not_a_route__');
    expect(res.status).toBe(404);
  });
});

describe('GET /runtime/:file (US-012 vendored Tailwind Play CDN)', () => {
  it('serves the vendored tailwind.js with a JS content-type', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web', disableWatcher: true });
    const res = await app.request('/runtime/tailwind.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('javascript');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1000);
  });

  it('sets a long-lived immutable cache-control', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web', disableWatcher: true });
    const res = await app.request('/runtime/tailwind.js');
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/immutable/);
    expect(cc).toMatch(/max-age=\d+/);
  });

  it('returns 404 for an unknown runtime file', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web', disableWatcher: true });
    const res = await app.request('/runtime/does-not-exist.js');
    expect(res.status).toBe(404);
  });

  it('rejects traversal-shaped segments via the route regex (no match → 404)', async () => {
    const app = createApp({ mode: 'prod', staticRoot: './dist/web', disableWatcher: true });
    const res = await app.request('/runtime/..%2Ftsconfig.json');
    expect(res.status).toBe(404);
  });

  it('resolves RUNTIME_ASSETS_DIR to apps/studio/public/runtime/ on disk', () => {
    const tailwindAbs = join(RUNTIME_ASSETS_DIR, 'tailwind.js');
    expect(existsSync(tailwindAbs)).toBe(true);
    expect(RUNTIME_ASSETS_DIR).toMatch(/public\/runtime$/);
  });
});

describe('GET /api/projects/:id/files/:path', () => {
  const buildFixture = () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-files-repo-'));
    mkdirSync(join(repoDir, '.seeflow', 'assets'), { recursive: true });
    writeFileSync(join(repoDir, '.seeflow', 'flow.json'), '{"version":2}');
    writeFileSync(join(repoDir, '.seeflow', 'assets', 'hello.txt'), 'hi there');
    writeFileSync(join(repoDir, '.seeflow', 'blocks-card.html'), '<p>hi</p>');
    // A secret file just outside .seeflow to verify traversal defense.
    writeFileSync(join(repoDir, 'secret.txt'), 'never expose me');

    const registry = createRegistry({
      path: join(mkdtempSync(join(tmpdir(), 'seeflow-files-reg-')), 'registry.json'),
    });
    const entry = registry.upsert({
      name: 'Files Test',
      repoPath: repoDir,
      flowPath: '.seeflow/flow.json',
    });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
    });
    return { app, projectId: entry.id, repoDir };
  };

  it('streams the file with a content-type for a happy path', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/assets/hello.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/plain');
    expect(await res.text()).toBe('hi there');
  });

  it('returns 404 for a missing file', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/assets/nope.txt`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toHaveProperty('error');
  });

  it('returns 400 when the path contains `..` traversal', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/..%2Fsecret.txt`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/traversal/i);
  });

  it('returns 400 when the path is absolute', async () => {
    const { app, projectId } = buildFixture();
    const res = await app.request(`/api/projects/${projectId}/files/%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/absolute/i);
  });

  it('returns 404 for an unknown projectId', async () => {
    const { app } = buildFixture();
    const res = await app.request('/api/projects/does-not-exist/files/assets/hello.txt');
    expect(res.status).toBe(404);
  });
});

interface ShelloutFixture {
  app: ReturnType<typeof createApp>;
  projectId: string;
  repoDir: string;
  calls: Array<{ cmd: string; args: string[] }>;
  blockHtmlAbs: string;
}

const buildShelloutFixture = (opts?: {
  spawnResult?: { ok: boolean; error?: string };
  platform?: NodeJS.Platform;
}): ShelloutFixture => {
  const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-shellout-repo-'));
  mkdirSync(join(repoDir, '.seeflow', 'blocks'), { recursive: true });
  writeFileSync(join(repoDir, '.seeflow', 'flow.json'), '{"version":2}');
  writeFileSync(join(repoDir, '.seeflow', 'blocks', 'card.html'), '<p>hi</p>');
  writeFileSync(join(repoDir, 'secret.txt'), 'never expose me');

  const registry = createRegistry({
    path: join(mkdtempSync(join(tmpdir(), 'seeflow-shellout-reg-')), 'registry.json'),
  });
  const entry = registry.upsert({
    name: 'Shellout Test',
    repoPath: repoDir,
    flowPath: '.seeflow/flow.json',
  });

  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawner: Spawner = async (cmd, args) => {
    calls.push({ cmd, args });
    return opts?.spawnResult ?? { ok: true };
  };

  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
    spawner,
    platform: opts?.platform,
  });

  // Match the realpath the resolver will produce (macOS /var → /private/var).
  return {
    app,
    projectId: entry.id,
    repoDir,
    calls,
    blockHtmlAbs: realpathSync(join(repoDir, '.seeflow', 'blocks', 'card.html')),
  };
};

const jsonPost = (path: string, body: unknown): Request =>
  new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// Save + restore process.env.EDITOR around a test. `value === undefined`
// clears the variable (using `delete` since `process.env.X = undefined`
// stringifies to "undefined" in node's env mirror, which would defeat the
// `EDITOR not set` branch).
const withEditor = async (value: string | undefined, run: () => Promise<void>) => {
  const prev = process.env.EDITOR;
  if (value === undefined) {
    // biome-ignore lint/performance/noDelete: assigning undefined to process.env coerces to the literal string "undefined".
    delete process.env.EDITOR;
  } else {
    process.env.EDITOR = value;
  }
  try {
    await run();
  } finally {
    if (prev === undefined) {
      // biome-ignore lint/performance/noDelete: see above — process.env requires `delete` to truly clear.
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = prev;
    }
  }
};

describe('POST /api/projects/:id/files/open', () => {
  it('spawns $EDITOR with the absolute path on the happy path', () =>
    withEditor('vim', async () => {
      const fix = buildShelloutFixture();
      const res = await fix.app.fetch(
        jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/card.html' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; absPath: string };
      expect(body.ok).toBe(true);
      expect(body.absPath).toBe(fix.blockHtmlAbs);
      expect(fix.calls).toEqual([{ cmd: 'vim', args: [fix.blockHtmlAbs] }]);
    }));

  it('returns absPath fallback (no spawn) when $EDITOR is unset', () =>
    withEditor(undefined, async () => {
      const fix = buildShelloutFixture();
      const res = await fix.app.fetch(
        jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/card.html' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; absPath: string; error: string };
      expect(body.ok).toBe(false);
      expect(body.absPath).toBe(fix.blockHtmlAbs);
      expect(body.error).toMatch(/EDITOR/);
      expect(fix.calls).toEqual([]);
    }));

  it('returns absPath fallback when spawn fails', () =>
    withEditor('no-such-editor', async () => {
      const fix = buildShelloutFixture({ spawnResult: { ok: false, error: 'spawn ENOENT' } });
      const res = await fix.app.fetch(
        jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/card.html' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; absPath: string; error: string };
      expect(body.ok).toBe(false);
      expect(body.absPath).toBe(fix.blockHtmlAbs);
      expect(body.error).toBe('spawn ENOENT');
    }));

  it('rejects `..` traversal with 400', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: '../secret.txt' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/traversal/i);
    expect(fix.calls).toEqual([]);
  });

  it('rejects absolute paths with 400', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: '/etc/passwd' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/absolute/i);
    expect(fix.calls).toEqual([]);
  });

  it('soft-fails with 404 JSON (no 500) for a missing file', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/open`, { path: 'blocks/nope.html' }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; absPath: string };
    expect(body.error).toMatch(/not found/i);
    expect(body.absPath).toBe(join(fix.repoDir, '.seeflow', 'blocks', 'nope.html'));
    expect(fix.calls).toEqual([]);
  });

  it('returns 404 for an unknown projectId', async () => {
    const fix = buildShelloutFixture();
    const res = await fix.app.fetch(
      jsonPost('/api/projects/does-not-exist/files/open', { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/:id/files/reveal', () => {
  it('uses `open -R <abs>` on darwin', async () => {
    const fix = buildShelloutFixture({ platform: 'darwin' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; absPath: string };
    expect(body.ok).toBe(true);
    expect(body.absPath).toBe(fix.blockHtmlAbs);
    expect(fix.calls).toEqual([{ cmd: 'open', args: ['-R', fix.blockHtmlAbs] }]);
  });

  it('uses `explorer /select,<abs>` on win32', async () => {
    const fix = buildShelloutFixture({ platform: 'win32' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    expect(fix.calls).toEqual([{ cmd: 'explorer', args: [`/select,${fix.blockHtmlAbs}`] }]);
  });

  it('uses `xdg-open <dir>` on linux', async () => {
    const fix = buildShelloutFixture({ platform: 'linux' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    expect(fix.calls).toEqual([{ cmd: 'xdg-open', args: [dirname(fix.blockHtmlAbs)] }]);
  });

  it('rejects `..` traversal with 400', async () => {
    const fix = buildShelloutFixture({ platform: 'darwin' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: '../secret.txt' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/traversal/i);
    expect(fix.calls).toEqual([]);
  });

  it('soft-fails with 404 JSON for a missing file', async () => {
    const fix = buildShelloutFixture({ platform: 'darwin' });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/nope.html' }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; absPath: string };
    expect(body.error).toMatch(/not found/i);
    expect(body.absPath).toBe(join(fix.repoDir, '.seeflow', 'blocks', 'nope.html'));
    expect(fix.calls).toEqual([]);
  });

  it('returns absPath fallback when spawn fails', async () => {
    const fix = buildShelloutFixture({
      platform: 'darwin',
      spawnResult: { ok: false, error: 'spawn ENOENT' },
    });
    const res = await fix.app.fetch(
      jsonPost(`/api/projects/${fix.projectId}/files/reveal`, { path: 'blocks/card.html' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; absPath: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.absPath).toBe(fix.blockHtmlAbs);
    expect(body.error).toBe('spawn ENOENT');
  });
});

describe('POST /api/projects/:id/files/upload', () => {
  const buildUploadFixture = () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-upload-repo-'));
    mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
    writeFileSync(join(repoDir, '.seeflow', 'flow.json'), '{"version":2}');

    const registry = createRegistry({
      path: join(mkdtempSync(join(tmpdir(), 'seeflow-upload-reg-')), 'registry.json'),
    });
    const entry = registry.upsert({
      name: 'Upload Test',
      repoPath: repoDir,
      flowPath: '.seeflow/flow.json',
    });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
    });
    return { app, projectId: entry.id, repoDir };
  };

  // 1×1 transparent PNG to act as a real image payload across the tests.
  const PNG_BYTES = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  const formPost = (path: string, form: FormData): Request =>
    new Request(`http://test${path}`, { method: 'POST', body: form });

  it('persists the upload and returns the relative path', async () => {
    const { app, projectId, repoDir } = buildUploadFixture();
    const form = new FormData();
    form.set('file', new File([PNG_BYTES], 'Hello World.png', { type: 'image/png' }));
    const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe('assets/hello-world.png');
    expect(existsSync(join(repoDir, '.seeflow', 'assets', 'hello-world.png'))).toBe(true);
    const written = readFileSync(join(repoDir, '.seeflow', 'assets', 'hello-world.png'));
    expect(new Uint8Array(written)).toEqual(PNG_BYTES);
  });

  it('uses the `filename` field when present', async () => {
    const { app, projectId, repoDir } = buildUploadFixture();
    const form = new FormData();
    form.set('file', new File([PNG_BYTES], 'blob', { type: 'image/png' }));
    form.set('filename', 'My Image.PNG');
    const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe('assets/my-image.png');
    expect(existsSync(join(repoDir, '.seeflow', 'assets', 'my-image.png'))).toBe(true);
  });

  it('dedupes with -2, -3 suffix when the same name already exists', async () => {
    const { app, projectId, repoDir } = buildUploadFixture();
    const upload = async (n: string) => {
      const form = new FormData();
      form.set('file', new File([PNG_BYTES], n, { type: 'image/png' }));
      const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
      return (await res.json()) as { path: string };
    };
    expect((await upload('logo.png')).path).toBe('assets/logo.png');
    expect((await upload('logo.png')).path).toBe('assets/logo-2.png');
    expect((await upload('logo.png')).path).toBe('assets/logo-3.png');
    expect(existsSync(join(repoDir, '.seeflow', 'assets', 'logo.png'))).toBe(true);
    expect(existsSync(join(repoDir, '.seeflow', 'assets', 'logo-2.png'))).toBe(true);
    expect(existsSync(join(repoDir, '.seeflow', 'assets', 'logo-3.png'))).toBe(true);
  });

  it('rejects non-image extensions with 400', async () => {
    const { app, projectId, repoDir } = buildUploadFixture();
    const form = new FormData();
    form.set(
      'file',
      new File([new TextEncoder().encode('hi')], 'notes.txt', { type: 'text/plain' }),
    );
    const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid|extension/i);
    expect(existsSync(join(repoDir, '.seeflow', 'assets'))).toBe(false);
  });

  it('rejects files larger than 5 MB with 413', async () => {
    const { app, projectId, repoDir } = buildUploadFixture();
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const form = new FormData();
    form.set('file', new File([big], 'big.png', { type: 'image/png' }));
    const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toMatch(/too large/i);
    expect(body.maxBytes).toBe(5 * 1024 * 1024);
    expect(existsSync(join(repoDir, '.seeflow', 'assets'))).toBe(false);
  });

  it('returns 400 when the file field is missing', async () => {
    const { app, projectId } = buildUploadFixture();
    const form = new FormData();
    form.set('filename', 'whatever.png');
    const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/file/i);
  });

  it('returns 404 for an unknown projectId', async () => {
    const { app } = buildUploadFixture();
    const form = new FormData();
    form.set('file', new File([PNG_BYTES], 'pic.png', { type: 'image/png' }));
    const res = await app.fetch(formPost('/api/projects/does-not-exist/files/upload', form));
    expect(res.status).toBe(404);
  });

  it('accepts SVG uploads', async () => {
    const { app, projectId, repoDir } = buildUploadFixture();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    const form = new FormData();
    form.set('file', new File([svg], 'icon.svg', { type: 'image/svg+xml' }));
    const res = await app.fetch(formPost(`/api/projects/${projectId}/files/upload`, form));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe('assets/icon.svg');
    expect(existsSync(join(repoDir, '.seeflow', 'assets', 'icon.svg'))).toBe(true);
  });
});
