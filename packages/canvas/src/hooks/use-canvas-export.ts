import type { ReactFlowInstance } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { type CapturedImage, captureViewportPng, downloadDataUrl } from '../lib/export-image.ts';

export interface UseCanvasExportInput {
  /** Project / demo id used to seed the download filename. */
  projectId?: string | null;
  /** Returns the live React Flow instance (or null if not yet mounted). */
  getReactFlow: () => ReactFlowInstance | null;
}

export interface UseCanvasExportApi {
  exportPdf: () => Promise<void>;
  exportPng: () => Promise<void>;
  lastError: string | null;
  clearError: () => void;
}

const sanitizeFileName = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'canvas';
};

const exportFileName = (projectId: string | null | undefined, ext: 'pdf' | 'png'): string =>
  `${sanitizeFileName(projectId ?? 'canvas')}.${ext}`;

/**
 * Hook that owns the canvas export workflow — fit-view + viewport capture +
 * filename derivation + dynamic-import of jspdf for PDF output. Mirrors the
 * orchestration that previously lived in `apps/web/src/pages/demo-view.tsx`
 * so every consumer of `<SeeflowCanvas>` gets PDF / PNG export for free.
 *
 * jspdf is `await import()`-ed on click (not at module top-level) to keep the
 * initial bundle slim; PNG capture goes through `html-to-image` which is
 * already loaded eagerly by `../lib/export-image.ts`.
 *
 * Errors during capture / save are caught and exposed via `lastError` rather
 * than re-thrown — the UI surfaces the message inline.
 */
export const useCanvasExport = ({
  projectId,
  getReactFlow,
}: UseCanvasExportInput): UseCanvasExportApi => {
  const [lastError, setLastError] = useState<string | null>(null);

  const clearError = useCallback(() => setLastError(null), []);

  const captureViewportFramed = useCallback(async (): Promise<CapturedImage | null> => {
    const rf = getReactFlow();
    if (!rf) return null;
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewportEl) return null;
    const prev = rf.getViewport();
    try {
      await rf.fitView({ duration: 0, padding: 0.1 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return await captureViewportPng(viewportEl);
    } finally {
      rf.setViewport(prev, { duration: 0 });
    }
  }, [getReactFlow]);

  const exportPng = useCallback(async (): Promise<void> => {
    setLastError(null);
    try {
      const captured = await captureViewportFramed();
      if (!captured) return;
      downloadDataUrl(captured.dataUrl, exportFileName(projectId, 'png'));
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, [captureViewportFramed, projectId]);

  const exportPdf = useCallback(async (): Promise<void> => {
    setLastError(null);
    try {
      const captured = await captureViewportFramed();
      if (!captured) return;
      const { jsPDF } = await import('jspdf');
      const orientation: 'landscape' | 'portrait' =
        captured.width > captured.height ? 'landscape' : 'portrait';
      const doc = new jsPDF({
        orientation,
        unit: 'px',
        format: [captured.width, captured.height],
        hotfixes: ['px_scaling'],
      });
      doc.addImage(captured.dataUrl, 'PNG', 0, 0, captured.width, captured.height);
      doc.save(exportFileName(projectId, 'pdf'));
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, [captureViewportFramed, projectId]);

  return { exportPdf, exportPng, lastError, clearError };
};
