import type { ComponentType, ReactNode } from 'react';
import { COMPONENT_NAMES } from '../catalog/component-catalog.ts';

/**
 * Catalog → React impl map consumed by ComponentRuntime.
 *
 * US-011 ships an identity-passthrough stub for every catalog name so the
 * runtime can mount and tests can assert against resolved props. US-012
 * replaces this file with the real shadcn / SeeFlow / lazy implementations.
 */
type ComponentImpl = ComponentType<Record<string, unknown> & { children?: ReactNode }>;

function makePassthrough(name: string): ComponentImpl {
  const Component: ComponentImpl = ({ children, ...rest }) => (
    <div data-component={name} {...(rest as Record<string, unknown>)}>
      {children}
    </div>
  );
  Component.displayName = `CatalogPassthrough(${name})`;
  return Component;
}

const components = Object.fromEntries(
  COMPONENT_NAMES.map((name) => [name, makePassthrough(name)] as const),
) as Record<string, ComponentImpl>;

export const componentRegistry: { components: Record<string, ComponentImpl> } = { components };
