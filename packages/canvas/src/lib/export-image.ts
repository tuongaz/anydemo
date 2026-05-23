import { toPng } from 'html-to-image';

/**
 * html-to-image filter that excludes React Flow chrome (minimap, controls, the
 * `Panel`-mounted toolbar / style strip / share menu) from a viewport capture.
 * Shared by PNG and PDF export so both formats render the same content.
 */
export const viewportExportFilter = (node: Node): boolean => {
  if (!(node instanceof Element)) return true;
  if (node.classList.contains('react-flow__minimap')) return false;
  if (node.classList.contains('react-flow__controls')) return false;
  if (node.classList.contains('react-flow__panel')) return false;
  return true;
};

/**
 * Walk up from a captured viewport element to the nearest `.seeflow-canvas-root`
 * and return the live `--bg-canvas` token via getComputedStyle. The runtime
 * read keeps PNG / PDF exports in sync with the active theme — light theme
 * exports use the light background, dark theme exports use the dark one.
 *
 * If the wrapper or token isn't resolvable, derive the fallback from the
 * `.dark` class on `<html>` so the export still matches the active theme
 * instead of being pinned to a hardcoded color.
 */
export const resolveCanvasBackground = (element: Element): string => {
  let current: Element | null = element;
  while (current && !current.classList.contains('seeflow-canvas-root')) {
    current = current.parentElement;
  }
  if (current) {
    const token = getComputedStyle(current).getPropertyValue('--bg-canvas').trim();
    if (token.length > 0) return token;
  }
  const html = element.ownerDocument?.documentElement;
  return html?.classList.contains('dark') ? '#0a0a0c' : '#fafafa';
};

export interface CapturedImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Capture a React Flow viewport element as a PNG data URL and measure the
 * resulting bitmap's natural dimensions. Both the dataUrl and pixel size are
 * needed downstream: PNG export wants the dataUrl, PDF export wants the
 * dimensions so the page format matches the captured aspect ratio.
 *
 * `backgroundColor` is sourced from the canvas wrapper's `--bg-canvas` token so
 * exports match the active theme's in-app canvas instead of html-to-image's
 * transparent default (which renders white in most viewers).
 */
export const captureViewportPng = async (element: HTMLElement): Promise<CapturedImage> => {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    filter: viewportExportFilter,
    backgroundColor: resolveCanvasBackground(element),
  });
  const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to decode captured image'));
    img.src = dataUrl;
  });
  return { dataUrl, ...dims };
};

/** Trigger a browser download for a data URL via a synthetic anchor click. */
export const downloadDataUrl = (dataUrl: string, filename: string): void => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};
