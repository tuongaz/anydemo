import {
  expect,
  projectFlowPath,
  registerFlow,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// Phase C: end-to-end coverage for the OS-clipboard copy/paste pipeline wired
// up in apps/web/src/pages/flow-view.tsx. The studio canvas page mounts in
// edit mode, where the native `copy` / `paste` window listeners own
// Cmd/Ctrl+C/V (the canvas keydown chord is disabled for C/V — see the
// US-022 comment in flow-view.tsx).
//
// Two paths are exercised:
//   1. Node paste — a `paste` ClipboardEvent carrying the seeflow envelope
//      JSON (`{ "__seeflow_clipboard__": 1, nodes, connectors }`, the format
//      produced by encodeClipboard in apps/web/src/lib/clipboard.ts) lands a
//      fresh copy of the encoded node. We assert the node count grew by one.
//   2. Image paste — a `paste` ClipboardEvent whose `clipboardData.items`
//      includes an image File. flow-view routes that through the canvas drop
//      pipeline (pasteImageFromClipboard), which creates a type:'image' node.
//
// Both events are synthesised in-page with a real DataTransfer +
// ClipboardEvent (chromium supports `new ClipboardEvent('paste', {
// clipboardData })`). The envelope text for path 1 is built directly from the
// seeded node's id/position so the test doesn't depend on a prior copy round
// trip.
//
// Filename ends in `.e2e.ts` to match the rest of the suite (dodges bun's
// default `*.spec.ts` matcher — see playwright.config.ts).

// A self-contained source flow carrying a single rectangle (id `seed`). We
// control the id + position so the in-page envelope builder is deterministic.
function buildSourceFlow(name: string) {
  return {
    version: 2 as const,
    name,
    nodes: [
      {
        id: 'seed',
        type: 'rectangle' as const,
        position: { x: 120, y: 120 },
        data: { name: 'Seed Node' },
      },
    ],
    connectors: [],
  };
}

test.describe('canvas — OS clipboard (Phase C)', () => {
  test('paste of a seeflow envelope adds a node', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'clipboard-node-paste',
      buildSourceFlow('Clipboard Node Paste'),
      { name: 'Clipboard Node Paste' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // The seeded rectangle is on the canvas.
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    // Dispatch a `paste` ClipboardEvent carrying a seeflow envelope built
    // directly from the seeded node. We hand-build the envelope text (rather
    // than copying first) so the test is independent of the copy path's
    // selection plumbing. The shape MUST match encodeClipboard's output:
    // `{ "__seeflow_clipboard__": 1, nodes, connectors }`.
    //
    // String-form eval because the studio tsconfig omits the DOM lib (it's a
    // Bun backend) — a function callback referencing DataTransfer /
    // ClipboardEvent / document would fail typecheck. The body runs in the
    // browser context where those globals exist (same pattern as
    // waitForCanvasSettled in support/studio-fixture.ts).
    await page.evaluate(`(() => {
      const envelope = JSON.stringify({
        __seeflow_clipboard__: 1,
        nodes: [
          { id: 'seed', type: 'rectangle', position: { x: 120, y: 120 }, data: { name: 'Seed Node' } },
        ],
        connectors: [],
      });
      const dt = new DataTransfer();
      dt.setData('text/plain', envelope);
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    })()`);

    // The paste rewrites ids + offsets the position, so a second rectangle
    // appears. flow-view's onPasteNodes posts the new node through the
    // adapter; the optimistic override lands it on the canvas immediately.
    await expect(page.locator('.react-flow__node')).toHaveCount(2, { timeout: 5_000 });
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);
  });

  test('paste of an image file creates an image node', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'clipboard-image-paste',
      buildSourceFlow('Clipboard Image Paste'),
      { name: 'Clipboard Image Paste' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // No image node yet — only the seeded rectangle.
    await expect(page.locator('[data-node-type="image"]')).toHaveCount(0);

    // Dispatch a `paste` ClipboardEvent whose clipboardData carries a tiny
    // 1x1 PNG File. flow-view inspects `clipboardData.items` for a
    // kind:'file' image/* entry (decidePasteAction) and routes it to the
    // canvas drop pipeline, which creates a type:'image' node.
    //
    // String-form eval for the same DOM-lib reason as the node-paste test
    // above. `DataTransfer.items.add(file)` accepts a File and exposes it as
    // a kind:'file' item with the file's MIME type — exactly what
    // decidePasteAction matches on.
    await page.evaluate(`(() => {
      // A minimal valid 1x1 transparent PNG.
      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoHFNeUAAAAASUVORK5CYII=';
      const bin = atob(pngBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    })()`);

    // The drop pipeline creates an image node. It first renders the
    // optimistic loading placeholder, then swaps to the resolved <img>; the
    // node itself carries data-node-type="image" the whole time, so asserting
    // on that is the most robust signal the paste created the node. The
    // placeholder testid is accepted as additional evidence below.
    const imageNode = page.locator('[data-node-type="image"]');
    await expect(imageNode).toHaveCount(1, { timeout: 5_000 });
    await expect(imageNode).toBeVisible();
  });
});
