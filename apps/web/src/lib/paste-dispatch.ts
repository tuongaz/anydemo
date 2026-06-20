import type { PasteableConnector, PasteableNode } from './clipboard';
import { parseClipboard } from './clipboard';

export interface PasteItemMeta {
  kind: string; // 'file' | 'string'
  type: string; // MIME
}

export interface DecidePasteInput {
  isEditable: boolean;
  items: readonly PasteItemMeta[];
  text: string;
}

export type PasteAction<
  N extends PasteableNode = PasteableNode,
  C extends PasteableConnector = PasteableConnector,
> =
  | { kind: 'ignore' }
  | { kind: 'image' }
  | { kind: 'nodes'; payload: { nodes: readonly N[]; connectors: readonly C[] } };

export function decidePasteAction(input: DecidePasteInput): PasteAction {
  if (input.isEditable) return { kind: 'ignore' };
  const hasImage = input.items.some(
    (it) => it.kind === 'file' && it.type.toLowerCase().startsWith('image/'),
  );
  if (hasImage) return { kind: 'image' };
  const parsed = parseClipboard(input.text);
  if (parsed) return { kind: 'nodes', payload: parsed };
  return { kind: 'ignore' };
}
