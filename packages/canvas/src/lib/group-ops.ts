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

/**
 * Padding (flow units) added on every side of the members' union rect when a
 * group box is computed. Comfortable breathing room so members aren't cramped
 * against the box edge / selection marquee (12 read as "too close"). The
 * selection marquee + connection dots track the box edge, so this value only
 * affects the gap between the members and the box — not the dot centering.
 */
export const GROUP_BOX_PADDING = 28;

/**
 * Absolute bounding box for a group enclosing `children`: the union of every
 * member's rect, expanded by `padding` on all sides (design §8). The box is
 * SYMMETRIC — there is no title band, because a group renders no header (it is a
 * chrome-less, Miro-style container; the marquee comes from the selection
 * overlay). Member dims are CALLER-RESOLVED (`measured ?? data ?? fallback`,
 * design §12.1) and passed in — this fn stays pure.
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
  // Expand by padding on all sides; members keep their absolute positions inside
  // the box.
  const x = minX - padding;
  const y = minY - padding;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
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
 * M6 isolation oracle (design §5.3 exit path c): is `nodeId` a member of the
 * group identified by `activeGroupId`? Pure + null-safe so the canvas can decide,
 * on a node click while a group is entered, whether to STAY inside (the click hit
 * a member) or EXIT (it hit a non-member). Returns false when:
 *   - `activeGroupId` is null (not in isolation),
 *   - the active id no longer resolves to a `type:'group'` node (vanished /
 *     ungrouped / a loose id passed defensively),
 *   - `nodeId` is not in that group's `childIds`.
 * The group's own id is never in its `childIds`, so a group is not its own member
 * — the title-bar exit affordance, not this oracle, handles a click on the active
 * group's chrome.
 */
export function isMemberOfGroup(
  nodes: readonly GroupOpNode[],
  activeGroupId: string | null,
  nodeId: string,
): boolean {
  if (activeGroupId === null) return false;
  const group = nodes.find((n) => n.id === activeGroupId);
  if (!isGroup(group)) return false;
  return readChildIds(group).includes(nodeId);
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

// ---------------------------------------------------------------------------
// M5 — group MOVE fan-out (design §9.1, §12.2)
// ---------------------------------------------------------------------------

/** A single absolute position update emitted by the group-move fan-out. */
export interface GroupMoveUpdate {
  id: string;
  position: { x: number; y: number };
}

/**
 * One dragged group's identity + the translation it underwent. `delta` is the
 * group's CURRENT position minus its drag-START position — i.e. the gesture's
 * additive translation. The caller derives it from a frozen drag-start snapshot
 * (NOT the previous frame), so applying it to each member's frozen start
 * position is additive and CANNOT compound (design §12.2 — unlike the
 * multiplicative resize path, there is no `sx·sx·…` trap here).
 */
export interface DraggedGroup {
  groupId: string;
  delta: { x: number; y: number };
}

/**
 * Pure fan-out for a group drag (design §9.1). For every dragged group, emit a
 * position update for each of its members (frozen start position + the group's
 * delta) PLUS the group's own new position. Used by BOTH the live per-frame
 * preview (delta = live − start) and the drag-stop commit (delta = committed −
 * start) so the two share one math implementation.
 *
 * Contract / guards:
 *   - **Additive, frozen-baseline.** Each member moves by `startPos + delta`
 *     where `startPos` comes from `startPositions` (the drag-START snapshot).
 *     The caller MUST pass start positions, never live/previous-frame ones, so
 *     repeated frames with the same delta land on the same spot (no drift).
 *   - **Dedupe (design §9.1, M5 step 2).** A member listed in `excludeIds` —
 *     because it is ALSO independently selected and therefore already moved by
 *     xyflow's own drag — is skipped so it isn't translated twice. The group's
 *     own id is likewise emitted at most once even if passed twice.
 *   - **Shared membership.** If two dragged groups list the same child (not
 *     possible under the no-double-membership invariant, but defended anyway),
 *     the first group's update wins and the duplicate is dropped.
 *   - A member without a `startPositions` entry is skipped (we can't translate
 *     a position we never snapshotted).
 *
 * @param draggedGroups   the groups being dragged, each with its delta
 * @param childIdsByGroup map groupId → its member ids (from `data.childIds`)
 * @param startPositions  drag-START absolute position per node id (group + members)
 * @param excludeIds      ids already moved directly by xyflow (independently
 *                        selected) — their members/selves are not re-emitted
 */
export function computeGroupMoveUpdates(
  draggedGroups: readonly DraggedGroup[],
  childIdsByGroup: ReadonlyMap<string, readonly string[]>,
  startPositions: ReadonlyMap<string, { x: number; y: number }>,
  excludeIds: ReadonlySet<string> = new Set(),
): GroupMoveUpdate[] {
  const updates: GroupMoveUpdate[] = [];
  const emitted = new Set<string>();
  const emit = (id: string, delta: { x: number; y: number }) => {
    if (emitted.has(id)) return; // already moved by an earlier group / direct drag
    if (excludeIds.has(id)) return; // moved directly by xyflow — don't double-apply
    const start = startPositions.get(id);
    if (!start) return; // no frozen baseline → can't translate
    emitted.add(id);
    updates.push({ id, position: { x: start.x + delta.x, y: start.y + delta.y } });
  };
  for (const { groupId, delta } of draggedGroups) {
    // The group node itself: xyflow already moved it visually, but the COMMIT
    // path still needs its final position persisted. The caller decides whether
    // to add the group to `excludeIds` (live preview: group already moved by
    // xyflow, exclude it) or not (commit: persist its position too).
    emit(groupId, delta);
    const childIds = childIdsByGroup.get(groupId) ?? [];
    for (const childId of childIds) emit(childId, delta);
  }
  return updates;
}

// ---------------------------------------------------------------------------
// M9 — clipboard (copy/paste) childIds remap + copy-set expansion (design §9.4)
// ---------------------------------------------------------------------------

/**
 * COPY completeness (design §9.4 / M9 step A.1): expand a copy selection so that
 * whenever a GROUP is in the set, ALL of its members come along too. Without
 * this, copying a selected group alone would clipboard a group node whose
 * `childIds` reference members that were never copied — the paste would then
 * prune them all (step A.2) and yield an empty group, losing the members.
 *
 * This is the ONE place copy is group-aware, and it is deliberately minimal: it
 * only GROWS the id set (exactly like the clipboard already auto-includes a
 * connector when both its endpoints are copied). It performs NO childIds
 * rewrite, NO reparenting — membership stays in the group's `childIds`. A member
 * selected WITHOUT its group is unaffected (it copies as a loose node; the paste
 * has no group referencing it, so no dangling ref — step A.2).
 *
 * Returns the expanded id list preserving `selectedIds` order, with each added
 * member appended in `childIds` order after the groups, deduped. Members that
 * don't resolve to an existing node are skipped (defensive against a stale
 * `childIds`).
 */
export function expandSelectionWithGroupMembers(
  nodes: readonly GroupOpNode[],
  selectedIds: readonly string[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of selectedIds) push(id);
  // Append members of every selected group (childIds order, deduped, existing).
  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!isGroup(node)) continue;
    for (const childId of readChildIds(node)) {
      if (byId.has(childId)) push(childId);
    }
  }
  return out;
}

/**
 * Minimal node shape the clipboard remap mutates: an `id` and the verbatim
 * `data` carried through the paste spread. We only ever read/rewrite
 * `data.childIds` on `type:'group'` nodes; every other field is left untouched.
 */
export interface RemapChildIdsNode {
  id: string;
  type?: string;
  data?: unknown;
}

/**
 * PASTE childIds remap (design §9.4 / M9 step A.2 — THE single id-remap pass).
 *
 * After {@link "../../../apps/web/src/lib/clipboard.ts" buildPastePayload} has
 * rewritten every node id and built the old→new `idMap`, the pasted nodes still
 * carry their ORIGINAL `data.childIds` (copied verbatim by the `...n` spread).
 * This pass rewrites each pasted GROUP's `childIds` through that SAME `idMap`:
 *
 *   - a child whose old id is in `idMap` → its NEW pasted id,
 *   - a child whose old id is NOT in `idMap` (a member that wasn't copied) →
 *     DROPPED (so the pasted group never references a node outside the paste,
 *     which the server's childIds-existence superRefine would reject).
 *
 * This is the whole reason `childIds` (not `parentId`) was chosen: one map, one
 * field, applied once — no per-node parent rewrites, no array reordering. The
 * function is pure and returns NEW node objects (a fresh `data` for groups);
 * non-group nodes pass through by reference.
 *
 * @param nodes the freshly-pasted nodes (already id+position rewritten)
 * @param idMap old-id → new-id, as produced by `buildPastePayload`
 */
export function remapGroupChildIds<N extends RemapChildIdsNode>(
  nodes: readonly N[],
  idMap: ReadonlyMap<string, string>,
): N[] {
  return nodes.map((n) => {
    if (n.type !== 'group') return n;
    const oldChildIds = readChildIds(n);
    const newChildIds: string[] = [];
    for (const oldId of oldChildIds) {
      const mapped = idMap.get(oldId);
      if (mapped !== undefined) newChildIds.push(mapped); // copied member → new id
      // else: member not in the paste → drop (no dangling childIds)
    }
    const prevData = (n.data ?? {}) as Record<string, unknown>;
    return { ...n, data: { ...prevData, childIds: newChildIds } };
  });
}

// ---------------------------------------------------------------------------
// M9 — delete policy + childIds prune ORDERING (design §9.3, §12.9)
// ---------------------------------------------------------------------------

/** A group's surviving membership after pruning the deleted members from it. */
export interface ChildIdsPrune {
  groupId: string;
  /** The group's `childIds` with every to-be-deleted member id removed. */
  childIds: string[];
}

/**
 * The ordered plan for a (possibly multi-target) node delete that keeps the
 * server's childIds-existence invariant valid at EVERY intermediate write
 * (design §12.9). `history.batch` issues N separate server writes (one undo
 * entry), and each write re-parses the WHOLE flow — so a transient state where a
 * surviving group still references a just-deleted member is REJECTED. Hence the
 * ordering is load-bearing, exactly like v1's unparent-before-delete.
 */
export interface GroupAwareDeletionPlan {
  /**
   * childIds prunes to apply FIRST, one per surviving group that loses ≥1
   * member. Applying these before any node delete means the group never
   * references a deleted child at any point. A group that is ITSELF being
   * deleted is NOT pruned here (its `childIds` die with it — moot, design §9.3).
   */
  childIdsPrunes: ChildIdsPrune[];
  /**
   * The node ids to delete, deduped. Order among deletes does NOT matter for the
   * childIds invariant once the prunes above have run (a deleted member is
   * already out of every surviving group). Deleting a GROUP releases its members
   * (they are NOT added here — children survive loose, design §9.3).
   */
  deleteIds: string[];
}

/**
 * Pure delete oracle (design §9.3 + §12.9). Given the live nodes and the set of
 * node ids the user asked to delete, produce the ordered {@link
 * GroupAwareDeletionPlan}:
 *
 *   - **Delete a member:** the owning group (if it SURVIVES) gets a childIds
 *     prune dropping that member; the prune is emitted in `childIdsPrunes` so the
 *     caller applies it BEFORE the member's `deleteNode`.
 *   - **Delete a group:** the group id is in `deleteIds`; its members are NOT
 *     added (released → survive loose). No prune is emitted for a deleted group
 *     (its childIds die with it).
 *   - **Marquee spanning a group + some of its members:** the group is deleted,
 *     so pruning it is moot → no prune for that group (dedupe, §12.9). Members in
 *     the set are still deleted.
 *
 * Deduping: `deleteIds` is the unique input set (a member listed twice, or a
 * group + member both selected, collapses). A surviving group appears at most
 * once in `childIdsPrunes`, even if several of its members are deleted at once.
 *
 * The plan is intentionally just "prune the one structural field, then delete" —
 * no group-awareness leaks beyond reading `childIds`. If this ever needed more,
 * the `childIds` decoupling would be breaking (the v1 signal).
 */
export function planGroupAwareDeletion(
  nodes: readonly GroupOpNode[],
  toDeleteIds: readonly string[],
): GroupAwareDeletionPlan {
  const deleteSet = new Set(toDeleteIds);
  const deleteIds = [...deleteSet]; // deduped, input order

  // For each SURVIVING group, compute its childIds minus any deleted member.
  const childIdsPrunes: ChildIdsPrune[] = [];
  for (const node of nodes) {
    if (!isGroup(node)) continue;
    if (deleteSet.has(node.id)) continue; // group itself deleted → prune is moot
    const childIds = readChildIds(node);
    const survivors = childIds.filter((id) => !deleteSet.has(id));
    if (survivors.length === childIds.length) continue; // lost no member → no write
    childIdsPrunes.push({ groupId: node.id, childIds: [...survivors] });
  }
  return { childIdsPrunes, deleteIds };
}
