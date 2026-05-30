import { type ReactNode, createContext, useContext } from 'react';

// Studio base URL surface for components that render studio-served assets
// (vendor icon SVGs from /api/icons/:vendor/:name.svg today). Empty string
// means same-origin — the canvas mounted alongside the studio resolves
// `${''}/api/icons/...` to a relative path. Embedders that point the canvas
// at a remote studio pass an absolute origin (e.g. `https://studio.example`).
export interface CanvasStudioValue {
  studioBaseUrl: string;
}

const DEFAULT: CanvasStudioValue = { studioBaseUrl: '' };

export const CanvasStudioContext = createContext<CanvasStudioValue>(DEFAULT);

export function CanvasStudioProvider({
  value,
  children,
}: {
  value: CanvasStudioValue;
  children: ReactNode;
}) {
  return <CanvasStudioContext.Provider value={value}>{children}</CanvasStudioContext.Provider>;
}

export function useCanvasStudio(): CanvasStudioValue {
  return useContext(CanvasStudioContext);
}
