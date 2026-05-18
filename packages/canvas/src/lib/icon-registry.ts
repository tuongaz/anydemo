import type { LucideIcon } from 'lucide-react';
import * as Lucide from 'lucide-react';

const NON_ICON_EXPORTS = new Set(['createLucideIcon', 'Icon', 'icons', 'default']);

const FORWARD_REF_SYMBOL = Symbol.for('react.forward_ref');

function isLucideIconComponent(value: unknown): value is LucideIcon {
  if (typeof value === 'function') return true;
  if (value !== null && typeof value === 'object') {
    const tag = (value as { $$typeof?: symbol }).$$typeof;
    return tag === FORWARD_REF_SYMBOL;
  }
  return false;
}

function pascalToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (char, index: number) =>
    index === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`,
  );
}

function buildRegistry(): Record<string, LucideIcon> {
  const registry: Record<string, LucideIcon> = {};
  for (const [name, value] of Object.entries(Lucide)) {
    if (NON_ICON_EXPORTS.has(name)) continue;
    if (!isLucideIconComponent(value)) continue;
    registry[pascalToKebab(name)] = value;
  }
  return registry;
}

export const ICON_REGISTRY: Record<string, LucideIcon> = buildRegistry();
export const ICON_FALLBACK_NAME = 'help-circle';
export const ICON_NAMES: string[] = Object.keys(ICON_REGISTRY).sort();
