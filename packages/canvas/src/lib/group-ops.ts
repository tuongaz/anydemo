/**
 * Canvas grouping M4 — pure group lifecycle ops.
 *
 * Membership is `childIds` + ABSOLUTE child positions (design §3 decision #1,
 * L0.3): create = add a group node listing members; ungroup = delete the group
 * node. There is NO child reparenting, NO position conversion, and NO array-
 * ordering invariant — the v1 `parentId` simplification. These functions are
 * deliberately ref-free / React-Flow-free so the geometry + the selection
 * oracle are unit-testable without a canvas (design §8).
 *
 * The CALLER (the host, which has `rfInstance`) resolves each member's size via
 * `measured ?? data.width/height ?? fallback` (design §12.1) and passes resolved
 * dims into {@link computeGroupBox} — relying on `data.width/height` alone would
 * exclude auto-sized html/component members and yield a too-small box. Keeping
 * the bbox math pure means it can be tested with explicit dims.
 */

import type { Rect } from './scale-nodes.ts';

/**
 * Minimal member shape {@link computeGroupBox} needs: an absolute top-left plus
 * the CALLER-RESOLVED width/height. A member without a resolvable size still
 * contributes its position to the bbox (so a zero-size member doesn't silently
 * vanish from the union, mirroring the overlay's union-rect resilience).
 */
export interface GroupBoxMember {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

/**
 * Minimal node shape the selection oracles read. `type` distinguishes a group
 * from a loose node; the (group-only) `data.childIds` lets us detect existing
 * membership so a node can't join two groups (design §4.1 invariants).
 *
 * `data` is typed `unknown` (not a `{ childIds? }` shape) on purpose: TypeScript
 * applies "weak type" detection to a target whose properties are ALL optional,
 * which would reject a concrete `FlowNode`'s `GeometricNodeData` ("no properties
 * in common"). Typing it `unknown` lets a real `FlowNode[]` pass without a cast
 * at every call site; `readChildIds` reads membership defensively.
 */
export interface GroupOpNode {
  id: string;
  type?: string;
  data?: unknown;
}

/** Safely read a node's `childIds` (only groups have it); [] for non-groups. */
function readChildIds(node: GroupOpNode | undefined): readonly string[] {
  const data = node?.data;
  if (data && typeof data === 'object' && 'childIds' in data) {
    const ids = (data as { childIds?: unknown }).childIds;
    if (Array.isArray(ids)) return ids as string[];
  }
  return [];
}

/** Padding (flow units) added on every side of the members' union rect. */
export const GROUP_BOX_PADDING = 12;

/**
 * Extra height (flow units) added ABOVE the members' union rect for the group's
 * title band (the top padding band the GroupNode renders its title into). Keeps
 * the title from overlapping the topmost member. Matches the v1 ~28px label slot.
 */
export const GROUP_TITLE_BAND_PX = 28;

/**
 * Absolute bounding box for a group enclosing `children`: the union of every
 * member's rect, expanded by `padding` on all sides PLUS an extra `titleBandPx`
 * band on top for the title (design §8). Member dims are CALLER-RESOLVED
 * (`measured ?? data ?? fallback`, design §12.1) and passed in — this fn stays
 * pure.
 *
 * Returns `null` for an empty `children` array: an empty group keeps its own
 * last explicit width/height rather than collapsing to a zero box (design
 * §9.11), so the caller decides the box for the member-less case; there is no
 * union to compute here.
 *
 * The returned `position` is the box's absolute top-left (group `position`);
 * `width`/`height` drive the rendered container. Members keep their absolute
 * positions and simply sit inside this box.
 */
export function computeGroupBox(
  children: readonly GroupBoxMember[],
  padding: number = GROUP_BOX_PADDING,
  titleBandPx: number = GROUP_TITLE_BAND_PX,
): { position: { x: number; y: number }; width: number; height: number } | null {
  if (children.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const c of children) {
    const w = c.width ?? 0;
    const h = c.height ?? 0;
    if (c.position.x < minX) minX = c.position.x;
    if (c.position.y < minY) minY = c.position.y;
    if (c.position.x + w > maxX) maxX = c.position.x + w;
    if (c.position.y + h > maxY) maxY = c.position.y + h;
  }
  // Expand by padding on all sides; the title band adds extra height on top, so
  // the group's top-left rises by (padding + titleBandPx) while members keep
  // their absolute positions inside the box.
  const x = minX - padding;
  const y = minY - padding - titleBandPx;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2 + titleBandPx;
  return { position: { x, y }, width, height };
}

/** True when `node` is a group container. */
function isGroup(node: GroupOpNode | undefined): boolean {
  return node?.type === 'group';
}

/**
 * Build the set of node ids that are ALREADY a member of some group (the union
 * of every group's `childIds`). Used to exclude already-grouped nodes from a new
 * group (no double-membership, design §4.1).
 */
function collectExistingMemberIds(nodes: readonly GroupOpNode[]): Set<string> {
  const members = new Set<string>();
  for (const n of nodes) {
    if (isGroup(n)) {
      for (const id of readChildIds(n)) members.add(id);
    }
  }
  return members;
}

/**
 * Eligible members for a NEW group from the current selection (design §8):
 *   - the id references an existing node,
 *   - the node is NOT already a member of any group (no double-membership),
 *   - the node is NOT itself a group (no nested groups in v1, design §9.7).
 *
 * Returns the eligible ids preserving `selectedIds` order. The CALL SITE
 * enforces the "≥2" rule (a single eligible node is not a group) — this fn just
 * filters so it can be reused/tested independently of the count gate.
 */
export function selectGroupableSet(
  nodes: readonly GroupOpNode[],
  selectedIds: readonly string[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const alreadyMembers = collectExistingMemberIds(nodes);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue; // doesn't exist
    if (isGroup(node)) continue; // a group can't be a member (no nesting)
    if (alreadyMembers.has(id)) continue; // already in another group
    out.push(id);
    seen.add(id);
  }
  return out;
}

/**
 * The selected GROUP ids (design §8) — selected nodes whose `type` is `'group'`,
 * in `selectedIds` order. Drives the ⊟ ungroup affordance and the ⌘⇧G chord.
 */
export function selectGroupSelection(
  nodes: readonly GroupOpNode[],
  selectedIds: readonly string[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    if (isGroup(node)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/**
 * Pure ⌘G / ⌘⇧G oracle (design §5.4, §8). Maps the current selection to the
 * single sensible action, or a reasoned no-op:
 *
 *   - 0 or 1 selected                  → none ('empty' / 'single')
 *   - all selected are loose & ≥2      → 'group'
 *   - exactly the selected group(s)    → 'ungroup' (1+ groups, nothing else)
 *   - a mix of group(s) + loose node(s)→ none ('mixed') — never nest
 *   - 2+ selected but <2 are groupable
 *     (e.g. all already-grouped)       → none ('not-groupable')
 *
 * Returning a `{ none: reason }` object (rather than a bare null) keeps every
 * branch explicit + testable — the v1 lesson that the ambiguous cases must be
 * enumerated up front, not discovered at runtime.
 */
export type GroupShortcutAction =
  | 'group'
  | 'ungroup'
  | { none: 'empty' | 'single' | 'mixed' | 'not-groupable' };

export function planGroupShortcutAction(
  nodes: readonly GroupOpNode[],
  selectedIds: readonly string[],
): GroupShortcutAction {
  // Dedupe defensively so a caller passing duplicate ids can't skew the counts.
  const uniqueIds = [...new Set(selectedIds)];
  if (uniqueIds.length === 0) return { none: 'empty' };
  if (uniqueIds.length === 1) {
    // A single selected group is NOT ungroupable via ⌘G's no-arg path here?
    // It IS: a lone group should ungroup. Distinguish group vs loose.
    const groups = selectGroupSelection(nodes, uniqueIds);
    if (groups.length === 1) return 'ungroup';
    return { none: 'single' };
  }

  const groups = selectGroupSelection(nodes, uniqueIds);
  // All selected are groups → ungroup them all.
  if (groups.length === uniqueIds.length) return 'ungroup';
  // A mix of group(s) + non-group(s) → ambiguous; never nest a group.
  if (groups.length > 0) return { none: 'mixed' };

  // No groups in the selection → candidate for create. Require ≥2 groupable
  // members (existing, loose, not already grouped).
  const groupable = selectGroupableSet(nodes, uniqueIds);
  if (groupable.length >= 2) return 'group';
  return { none: 'not-groupable' };
}
