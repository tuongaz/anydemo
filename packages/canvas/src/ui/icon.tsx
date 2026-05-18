import type { LucideProps } from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  createContext,
  useContext,
} from 'react';
import { ICON_FALLBACK_NAME, ICON_REGISTRY } from '../lib/icon-registry.ts';

export interface IconRegistryValue {
  custom: Record<string, ComponentType<LucideProps>>;
}

// Internal context — exported only via IconRegistryProvider / useIconRegistry.
// Default value is an empty custom map so <Icon> outside a provider still
// resolves built-in lucide icons by name.
const IconRegistryContext = createContext<IconRegistryValue>({ custom: {} });

export interface IconRegistryProviderProps {
  value: IconRegistryValue;
  children: ReactNode;
}

export function IconRegistryProvider({ value, children }: IconRegistryProviderProps) {
  return <IconRegistryContext.Provider value={value}>{children}</IconRegistryContext.Provider>;
}

export function useIconRegistry(): IconRegistryValue {
  return useContext(IconRegistryContext);
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  name?: string;
  as?: ComponentType<LucideProps>;
  size?: number | string;
  fallback?: string;
}

// Resolution order:
//   1. `as` prop (direct component injection)
//   2. custom registry by name (host-registered)
//   3. ICON_REGISTRY by name (built-in lucide)
//   4. ICON_REGISTRY[fallback]
// Color inherits via `currentColor`; caller styles via className / style.
export function Icon({ name, as, size = 16, fallback = ICON_FALLBACK_NAME, ...rest }: IconProps) {
  const registry = useIconRegistry();
  const Component: ComponentType<LucideProps> | undefined =
    as ??
    (name ? registry.custom[name] : undefined) ??
    (name ? ICON_REGISTRY[name] : undefined) ??
    ICON_REGISTRY[fallback];
  if (!Component) return null;
  return <Component size={size} {...rest} />;
}
