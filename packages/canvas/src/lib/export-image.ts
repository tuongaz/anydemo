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
 */
export const captureViewportPng = async (element: HTMLElement): Promise<CapturedImage> => {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    filter: viewportExportFilter,
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
