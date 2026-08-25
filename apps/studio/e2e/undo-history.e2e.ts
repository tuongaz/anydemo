// Regression coverage for the undo-history stale-clear bug.
//
// Symptom: Cmd+Z did "nothing at all" for text / color / move edits. Root
// cause: the host called `history.markExternalChange()` on EVERY `flowNodes`
// identity change — including benign SSE reconnect catch-ups (`hello` →
// `refreshDetail`). Because the wrapper's stale-clear uses a 2s wall-clock
// window, any reconnect landing >2s after the last edit wiped the entire undo
// stack, so by the time the user pressed Cmd+Z the cursor was back at 0.
//
// The fix keys the stale-clear on a signal bumped ONLY by genuine
// `flow:reload` events, so a routine reconnect can no longer clear undo. This
// test reproduces the exact failure condition: edit → wait past the 2s window
// → force an SSE reconnect → Cmd+Z must still revert. (It also exercises the
// override-prune + null-clear inverse fixes end-to-end.)
//
// Filename ends in `.e2e.ts` (not `.spec.ts`) so bun test's default discovery
// can't pick it up — same convention as the other studio e2e suites.

import { expect, projectFlowPath, registerFlow, test } from './support/studio-fixture.ts';

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

test.describe('undo history survives SSE reconnect', () => {
  test('Cmd+Z reverts a color edit after the stale window and a reconnect', async ({
    page,
    studio,
  }) => {
    // Isolated single-node flow so we never mutate the shared kitchen-sink
    // fixture (whose visual snapshots other specs assert against).
    const flow = await registerFlow(
      studio.studio,
      'undo-history-regression',
      {
        version: 2,
        name: 'Undo History Regression',
        nodes: [
          {
            id: 'n1',
            type: 'rectangle',
            position: { x: 0, y: 0 },
            data: { name: 'Box', borderColor: 'green' },
          },
        ],
        connectors: [],
      },
      { name: 'Undo History Regression' },
    );

    await page.goto(`${studio.studio.baseURL}${projectFlowPath(flow.projectSlug, flow.flowSlug)}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });

    const flowApi = `${studio.studio.baseURL}/api/projects/${flow.projectSlug}/flows/${flow.flowSlug}`;
    const serverBorderColor = async (): Promise<unknown> => {
      const res = await page.request.get(flowApi);
      const detail = (await res.json()) as {
        flow?: { nodes?: Array<{ id: string; data?: Record<string, unknown> }> };
      };
      return detail.flow?.nodes?.find((n) => n.id === 'n1')?.data?.borderColor;
    };
    expect(await serverBorderColor()).toBe('green');

    // ── Apply a color via the style strip ────────────────────────────────
    await page.locator('.react-flow__node[data-id="n1"]').click();
    await page.locator('[data-testid="style-strip-color-button"]').click();
    await page.locator('[data-testid="style-tab-color-red"]').click();
    await expect.poll(serverBorderColor).toBe('red');

    // ── Reproduce the failure condition ──────────────────────────────────
    // Wait past the 2s stale-mutation window, then abort the live SSE once so
    // the browser's EventSource reconnects (→ hello → refreshDetail → a
    // flowNodes identity change). Pre-fix this fired markExternalChange and
    // wiped the undo stack; the fix keys the stale-clear on real flow:reloads
    // only, so the stack must survive.
    await page.waitForTimeout(2200);
    let aborted = false;
    await page.route('**/api/events**', async (route) => {
      if (!aborted) {
        aborted = true;
        await route.abort();
        return;
      }
      await route.continue();
    });
    // Give EventSource time to error, retry (~3s), reconnect, and refetch.
    await page.waitForTimeout(5000);
    await page.unroute('**/api/events**');

    // ── Undo must still revert (asserted against the SERVER, so the result is
    // independent of SSE echo-delivery timing) ──────────────────────────────
    // Re-select the node so focus is on a non-editable surface (the chord
    // defers to the browser when an input/textarea/contentEditable is active).
    await page.locator('.react-flow__node[data-id="n1"]').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(serverBorderColor, { timeout: 10_000 }).toBe('green');
  });
});
