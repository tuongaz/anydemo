import { type ReactNode, type RefObject, createContext, useContext } from 'react';

const PortalContainerContext = createContext<HTMLElement | null>(null);

export function CanvasPortalContainerProvider({
  containerRef,
  children,
}: {
  containerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={containerRef.current}>
      {children}
    </PortalContainerContext.Provider>
  );
}

export function useCanvasPortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
