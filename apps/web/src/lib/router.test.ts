import { describe, expect, it } from 'bun:test';
import { flowPath, matchProjectAlone, matchProjectFlow, stripBase, withBase } from '@/lib/router';

// Base-aware routing: the SPA's custom history router operates in
// base-RELATIVE space so the matchers work unchanged whether the studio is
// served at `/` (standalone) or `/app` (cloud). `stripBase`/`withBase` are the
// pure seam between the served pathname and the base-relative path. They take
// an explicit `base` arg so both the `''` (standalone) and `/app` (cloud)
// regimes are testable without mutating `import.meta.env.BASE_URL`.

describe('stripBase', () => {
  describe("empty base ('' — standalone studio)", () => {
    it('is a no-op for any path', () => {
      expect(stripBase('/projects/p/flows/f', '')).toBe('/projects/p/flows/f');
      expect(stripBase('/', '')).toBe('/');
      expect(stripBase('/app/projects/p', '')).toBe('/app/projects/p');
    });
  });

  describe("base '/app' (cloud)", () => {
    it('strips the base prefix from a nested path', () => {
      expect(stripBase('/app/projects/p/flows/f', '/app')).toBe('/projects/p/flows/f');
    });

    it('maps the bare base to the base root "/"', () => {
      expect(stripBase('/app', '/app')).toBe('/');
    });

    it('strips when the path is exactly the base with a trailing slash', () => {
      expect(stripBase('/app/', '/app')).toBe('/');
    });

    it('leaves a path that does not start with the base unchanged (defensive)', () => {
      expect(stripBase('/projects/p', '/app')).toBe('/projects/p');
      // A path that merely shares a prefix segment but isn't base-rooted.
      expect(stripBase('/application/x', '/app')).toBe('/application/x');
    });
  });
});

describe('withBase', () => {
  describe("empty base ('' — standalone studio)", () => {
    it('is a no-op for any path', () => {
      expect(withBase('/projects/p/flows/f', '')).toBe('/projects/p/flows/f');
      expect(withBase('/', '')).toBe('/');
    });
  });

  describe("base '/app' (cloud)", () => {
    it('prepends the base to a nested path', () => {
      expect(withBase('/projects/p/flows/f', '/app')).toBe('/app/projects/p/flows/f');
    });

    it('maps the base-relative root "/" to the bare base (no trailing slash)', () => {
      expect(withBase('/', '/app')).toBe('/app');
    });
  });
});

describe('withBase ∘ stripBase round-trip', () => {
  for (const base of ['', '/app']) {
    for (const path of ['/', '/projects/p', '/projects/p/flows/f']) {
      it(`base=${JSON.stringify(base)} path=${path} round-trips`, () => {
        expect(stripBase(withBase(path, base), base)).toBe(path);
      });
    }
  }
});

// Boot mode: when the host injects a BootConfig, the router switches to the
// `/flows/<flow>` grammar (project FIXED to boot.projectSlug; no /projects
// segment) and the base root maps to the project's default flow. With boot
// null, every matcher/builder must behave byte-for-byte as before.
describe('boot mode', () => {
  const boot = { base: '/p/abc', projectSlug: 'meally', flowId: 'main', mode: 'edit' as const };

  describe('flowPath', () => {
    it('builds /flows/<flow> under boot (project arg ignored)', () => {
      expect(flowPath('meally', 'retry', boot)).toBe('/flows/retry');
      expect(flowPath('ignored-project', 'main', boot)).toBe('/flows/main');
    });

    it('builds the legacy /projects/:p/flows/:f grammar when boot is null', () => {
      expect(flowPath('p', 'f', null)).toBe('/projects/p/flows/f');
    });
  });

  describe('matchProjectFlow', () => {
    it('parses /flows/<flow> to the fixed project under boot', () => {
      expect(matchProjectFlow('/flows/retry', boot)).toEqual({ project: 'meally', flow: 'retry' });
    });

    it('maps the base root "/" to the project default flow under boot', () => {
      expect(matchProjectFlow('/', boot)).toEqual({ project: 'meally', flow: 'main' });
    });

    it('rejects the legacy grammar under boot', () => {
      expect(matchProjectFlow('/projects/p/flows/f', boot)).toBeNull();
    });

    it('rejects the new grammar when boot is null', () => {
      expect(matchProjectFlow('/flows/f', null)).toBeNull();
    });

    it('parses the legacy grammar when boot is null', () => {
      expect(matchProjectFlow('/projects/p/flows/f', null)).toEqual({ project: 'p', flow: 'f' });
    });
  });

  describe('matchProjectAlone', () => {
    it('never matches under boot (no project-only landing)', () => {
      expect(matchProjectAlone('/flows/x', boot)).toBeNull();
    });
  });

  describe('stripBase / withBase with the boot base', () => {
    it('strips the boot base', () => {
      expect(stripBase('/p/abc/flows/retry', '/p/abc')).toBe('/flows/retry');
    });

    it('re-attaches the boot base', () => {
      expect(withBase('/flows/retry', '/p/abc')).toBe('/p/abc/flows/retry');
    });
  });
});
