import { describe, expect, it } from 'bun:test';
import {
  GROUP_BOX_PADDING,
  GROUP_TITLE_BAND_PX,
  type GroupBoxMember,
  type GroupOpNode,
  computeGroupBox,
  computeGroupMoveUpdates,
  expandSelectionWithGroupMembers,
  isMemberOfGroup,
  planGroupAwareDeletion,
  planGroupShortcutAction,
  remapGroupChildIds,
  selectGroupSelection,
  selectGroupableSet,
} from './group-ops.ts';

// Loose node factory.
const loose = (id: string): GroupOpNode => ({ id, type: 'rectangle', data: {} });
// Group node factory listing its members.
const group = (id: string, childIds: string[]): GroupOpNode => ({
  id,
  type: 'group',
  data: { childIds },
});
const member = (id: string, x: number, y: number, w?: number, h?: number): GroupBoxMember => ({
  id,
  position: { x, y },
  width: w,
  height: h,
});

describe('computeGroupBox', () => {
  it('returns null for an empty member set (empty group keeps its own size)', () => {
    expect(computeGroupBox([])).toBeNull();
  });

  it('encloses a single member with padding all sides + a title band on top', () => {
    const box = computeGroupBox([member('a', 100, 100, 80, 60)]);
    expect(box).not.toBeNull();
    if (!box) return;
    // x/width: padding on left+right. y/height: padding both + title band on top.
    expect(box.position.x).toBe(100 - GROUP_BOX_PADDING);
    expect(box.position.y).toBe(100 - GROUP_BOX_PADDING - GROUP_TITLE_BAND_PX);
    expect(box.width).toBe(80 + GROUP_BOX_PADDING * 2);
    expect(box.height).toBe(60 + GROUP_BOX_PADDING * 2 + GROUP_TITLE_BAND_PX);
  });

  it('encloses the UNION of multiple members', () => {
    const box = computeGroupBox([member('a', 0, 0, 100, 100), member('b', 200, 150, 50, 50)]);
    if (!box) throw new Error('box null');
    // union: (0,0)→(250,200)
    expect(box.position.x).toBe(0 - GROUP_BOX_PADDING);
    expect(box.position.y).toBe(0 - GROUP_BOX_PADDING - GROUP_TITLE_BAND_PX);
    expect(box.width).toBe(250 + GROUP_BOX_PADDING * 2);
    expect(box.height).toBe(200 + GROUP_BOX_PADDING * 2 + GROUP_TITLE_BAND_PX);
  });

  it('honors custom padding + titleBand args', () => {
    const box = computeGroupBox([member('a', 10, 10, 20, 20)], 5, 10);
    if (!box) throw new Error('box null');
    expect(box.position.x).toBe(5);
    expect(box.position.y).toBe(10 - 5 - 10);
    expect(box.width).toBe(20 + 10);
    expect(box.height).toBe(20 + 10 + 10);
  });

  it('reserves enough top band for the rendered title header (M7: no member overlap)', () => {
    // The GroupNode title uses the shared NodeHeader (`py-3` = 24px + an 18px
    // `leading-tight` title ≈ 46px). The top reserve above the topmost member is
    // GROUP_BOX_PADDING + GROUP_TITLE_BAND_PX; it must clear that header so the
    // editable title never paints under a member. Guards the M7 band sizing.
    const APPROX_HEADER_PX = 46;
    expect(GROUP_BOX_PADDING + GROUP_TITLE_BAND_PX).toBeGreaterThanOrEqual(APPROX_HEADER_PX);
  });

  it('treats a member without resolvable dims as a zero-size point (still bounds it)', () => {
    // A member missing width/height (e.g. an unmeasured auto-sized node the
    // caller could not resolve) contributes only its position — it must NOT be
    // dropped from the union (so the box never silently shrinks past it).
    const box = computeGroupBox([member('a', 0, 0, 100, 100), member('b', 300, 300)]);
    if (!box) throw new Error('box null');
    // union still reaches (300,300) via the point.
    expect(box.position.x).toBe(0 - GROUP_BOX_PADDING);
    expect(box.width).toBe(300 + GROUP_BOX_PADDING * 2);
    expect(box.height).toBe(300 + GROUP_BOX_PADDING * 2 + GROUP_TITLE_BAND_PX);
  });
});

describe('selectGroupableSet', () => {
  it('returns loose, existing, non-grouped, non-group selected ids in order', () => {
    const nodes = [loose('a'), loose('b'), loose('c')];
    expect(selectGroupableSet(nodes, ['c', 'a'])).toEqual(['c', 'a']);
  });

  it('excludes ids that do not exist', () => {
    const nodes = [loose('a')];
    expect(selectGroupableSet(nodes, ['a', 'ghost'])).toEqual(['a']);
  });

  it('excludes a node that is already a member of a group', () => {
    const nodes = [loose('a'), loose('b'), group('g1', ['a'])];
    // 'a' is already in g1, so only 'b' is groupable.
    expect(selectGroupableSet(nodes, ['a', 'b'])).toEqual(['b']);
  });

  it('excludes a group node itself (no nesting in v1)', () => {
    const nodes = [loose('a'), group('g1', [])];
    expect(selectGroupableSet(nodes, ['a', 'g1'])).toEqual(['a']);
  });

  it('dedupes repeated ids', () => {
    const nodes = [loose('a'), loose('b')];
    expect(selectGroupableSet(nodes, ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('selectGroupSelection', () => {
  it('returns selected group ids in order', () => {
    const nodes = [loose('a'), group('g1', ['a']), group('g2', [])];
    expect(selectGroupSelection(nodes, ['g2', 'a', 'g1'])).toEqual(['g2', 'g1']);
  });

  it('returns [] when no selected node is a group', () => {
    const nodes = [loose('a'), loose('b')];
    expect(selectGroupSelection(nodes, ['a', 'b'])).toEqual([]);
  });

  it('ignores non-existent ids', () => {
    const nodes = [group('g1', [])];
    expect(selectGroupSelection(nodes, ['g1', 'ghost'])).toEqual(['g1']);
  });
});

describe('planGroupShortcutAction — full case matrix (design §5.4 / §8)', () => {
  const nodes = [
    loose('a'),
    loose('b'),
    loose('c'),
    group('g1', ['a']), // a is already grouped in g1
    group('g2', []),
  ];

  it('0 selected → none(empty)', () => {
    expect(planGroupShortcutAction(nodes, [])).toEqual({ none: 'empty' });
  });

  it('1 loose selected → none(single)', () => {
    expect(planGroupShortcutAction(nodes, ['b'])).toEqual({ none: 'single' });
  });

  it('1 group selected → ungroup', () => {
    expect(planGroupShortcutAction(nodes, ['g1'])).toBe('ungroup');
    expect(planGroupShortcutAction(nodes, ['g2'])).toBe('ungroup');
  });

  it('2+ loose (all groupable) → group', () => {
    expect(planGroupShortcutAction(nodes, ['b', 'c'])).toBe('group');
  });

  it('exactly the group(s) selected (multi) → ungroup', () => {
    expect(planGroupShortcutAction(nodes, ['g1', 'g2'])).toBe('ungroup');
  });

  it('mixed group + loose → none(mixed)', () => {
    expect(planGroupShortcutAction(nodes, ['g1', 'b'])).toEqual({ none: 'mixed' });
    expect(planGroupShortcutAction(nodes, ['g2', 'b', 'c'])).toEqual({ none: 'mixed' });
  });

  it('2+ selected but <2 groupable (all already grouped) → none(not-groupable)', () => {
    // Build a flow where the two selected loose nodes are BOTH already members.
    const flow = [loose('x'), loose('y'), group('gg', ['x', 'y'])];
    expect(planGroupShortcutAction(flow, ['x', 'y'])).toEqual({ none: 'not-groupable' });
  });

  it('2 selected, one is a ghost id → none(not-groupable) (only 1 real groupable)', () => {
    expect(planGroupShortcutAction(nodes, ['b', 'ghost'])).toEqual({ none: 'not-groupable' });
  });

  it('dedupes duplicate selection ids before deciding', () => {
    // ['b','b'] is really a single selection → none(single), not group.
    expect(planGroupShortcutAction(nodes, ['b', 'b'])).toEqual({ none: 'single' });
  });
});

describe('computeGroupMoveUpdates (M5 group move fan-out, §9.1)', () => {
  // A standard one-group flow: group g1 at (100,100) with members a (120,120)
  // and b (380,120).
  const childIds = new Map<string, readonly string[]>([['g1', ['a', 'b']]]);
  const starts = new Map<string, { x: number; y: number }>([
    ['g1', { x: 100, y: 100 }],
    ['a', { x: 120, y: 120 }],
    ['b', { x: 380, y: 120 }],
  ]);

  it('fans the group delta out to every member + the group itself', () => {
    const updates = computeGroupMoveUpdates(
      [{ groupId: 'g1', delta: { x: 50, y: -30 } }],
      childIds,
      starts,
    );
    // Sorted for stable comparison.
    const byId = Object.fromEntries(updates.map((u) => [u.id, u.position]));
    expect(byId.g1).toEqual({ x: 150, y: 70 });
    expect(byId.a).toEqual({ x: 170, y: 90 });
    expect(byId.b).toEqual({ x: 430, y: 90 });
    // Every delta is identical → relative layout is preserved.
    expect(updates).toHaveLength(3);
  });

  it('is ADDITIVE from the start snapshot: re-running with the same delta is idempotent (no drift)', () => {
    // §12.2: the delta is read against the drag-START snapshot, never the
    // previous frame. Two frames carrying the same delta must land on the same
    // absolute spot — proof the live path cannot drift/compound.
    const args = [[{ groupId: 'g1', delta: { x: 40, y: 40 } }], childIds, starts] as const;
    const frame1 = computeGroupMoveUpdates(...args);
    const frame2 = computeGroupMoveUpdates(...args);
    expect(frame2).toEqual(frame1);
    const a2 = frame2.find((u) => u.id === 'a');
    expect(a2?.position).toEqual({ x: 160, y: 160 });
  });

  it('excludeIds: a member also independently selected is NOT moved twice (dedupe §9.1 step 2)', () => {
    // `a` is independently selected, so xyflow already moved it as part of the
    // drag set — exclude it from the fan-out.
    const updates = computeGroupMoveUpdates(
      [{ groupId: 'g1', delta: { x: 10, y: 10 } }],
      childIds,
      starts,
      new Set(['a']),
    );
    const ids = updates.map((u) => u.id).sort();
    expect(ids).toEqual(['b', 'g1']);
  });

  it('excludeIds covering the group itself omits the group (live-preview shape)', () => {
    // Live preview excludes the group (xyflow already moves it visually) and
    // only fans to the members.
    const updates = computeGroupMoveUpdates(
      [{ groupId: 'g1', delta: { x: 5, y: 5 } }],
      childIds,
      starts,
      new Set(['g1']),
    );
    expect(updates.map((u) => u.id).sort()).toEqual(['a', 'b']);
  });

  it('skips members with no start-snapshot entry (can not translate an unknown baseline)', () => {
    const partialStarts = new Map<string, { x: number; y: number }>([
      ['g1', { x: 0, y: 0 }],
      ['a', { x: 10, y: 10 }],
      // 'b' intentionally absent.
    ]);
    const updates = computeGroupMoveUpdates(
      [{ groupId: 'g1', delta: { x: 1, y: 1 } }],
      childIds,
      partialStarts,
    );
    expect(updates.map((u) => u.id).sort()).toEqual(['a', 'g1']);
  });

  it('two dragged groups: shared child is emitted once (first group wins)', () => {
    const twoGroups = new Map<string, readonly string[]>([
      ['g1', ['a', 'shared']],
      ['g2', ['shared', 'c']],
    ]);
    const s = new Map<string, { x: number; y: number }>([
      ['g1', { x: 0, y: 0 }],
      ['g2', { x: 0, y: 0 }],
      ['a', { x: 1, y: 1 }],
      ['shared', { x: 2, y: 2 }],
      ['c', { x: 3, y: 3 }],
    ]);
    const updates = computeGroupMoveUpdates(
      [
        { groupId: 'g1', delta: { x: 100, y: 0 } },
        { groupId: 'g2', delta: { x: 0, y: 100 } },
      ],
      twoGroups,
      s,
    );
    const shared = updates.filter((u) => u.id === 'shared');
    expect(shared).toHaveLength(1);
    // g1 ran first, so `shared` uses g1's delta.
    expect(shared[0]?.position).toEqual({ x: 102, y: 2 });
  });

  it('empty group (no childIds) emits only the group position', () => {
    const updates = computeGroupMoveUpdates(
      [{ groupId: 'g1', delta: { x: 7, y: 7 } }],
      new Map([['g1', []]]),
      new Map([['g1', { x: 0, y: 0 }]]),
    );
    expect(updates).toEqual([{ id: 'g1', position: { x: 7, y: 7 } }]);
  });
});

// ---------------------------------------------------------------------------
// M6 — isolation membership oracle (design §5.3 exit path c)
// ---------------------------------------------------------------------------

describe('isMemberOfGroup', () => {
  const nodes: GroupOpNode[] = [
    group('g1', ['a', 'b']),
    group('g2', ['c']),
    loose('a'),
    loose('b'),
    loose('c'),
    loose('d'),
  ];

  it('true for a node listed in the group childIds', () => {
    expect(isMemberOfGroup(nodes, 'g1', 'a')).toBe(true);
    expect(isMemberOfGroup(nodes, 'g1', 'b')).toBe(true);
  });

  it('false for a loose node not in the group', () => {
    expect(isMemberOfGroup(nodes, 'g1', 'd')).toBe(false);
  });

  it('false for a node that belongs to a DIFFERENT group', () => {
    // `c` is a member of g2, not g1 — clicking it while g1 is active must exit.
    expect(isMemberOfGroup(nodes, 'g1', 'c')).toBe(false);
  });

  it('false when the active group id does not resolve to a group node', () => {
    // The active group vanished (ungrouped/deleted) — nothing is its member.
    expect(isMemberOfGroup(nodes, 'gone', 'a')).toBe(false);
  });

  it('false when the active group id points at a non-group node', () => {
    // Defensive: a loose id passed as the active group has no members.
    expect(isMemberOfGroup(nodes, 'a', 'b')).toBe(false);
  });

  it('the group node itself is NOT its own member (so dblclicking it stays inside)', () => {
    // The group id is never in its own childIds; clicking the group chrome while
    // active is therefore "not a member" — handled separately (title bar exit),
    // never auto-exiting via the non-member path.
    expect(isMemberOfGroup(nodes, 'g1', 'g1')).toBe(false);
  });

  it('false when activeGroupId is null', () => {
    expect(isMemberOfGroup(nodes, null, 'a')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M9 — clipboard copy-set expansion (design §9.4)
// ---------------------------------------------------------------------------
describe('expandSelectionWithGroupMembers', () => {
  const nodes: GroupOpNode[] = [
    group('g1', ['a', 'b']),
    loose('a'),
    loose('b'),
    loose('c'),
    group('g2', ['d']),
    loose('d'),
  ];

  it('pulls a selected group’s members into the copy set', () => {
    // Selecting only the group must include a + b (else paste yields an empty group).
    expect(expandSelectionWithGroupMembers(nodes, ['g1'])).toEqual(['g1', 'a', 'b']);
  });

  it('leaves a loose-only selection unchanged (no group → no expansion)', () => {
    expect(expandSelectionWithGroupMembers(nodes, ['c'])).toEqual(['c']);
  });

  it('a member copied WITHOUT its group is not expanded back to the group', () => {
    // Only the member is selected; the group is NOT pulled in (it copies loose).
    expect(expandSelectionWithGroupMembers(nodes, ['a'])).toEqual(['a']);
  });

  it('dedupes a member that is both selected and a group member', () => {
    expect(expandSelectionWithGroupMembers(nodes, ['g1', 'a'])).toEqual(['g1', 'a', 'b']);
  });

  it('expands multiple selected groups (selected ids first, then members)', () => {
    // All selected ids are emitted in selection order first, then each group's
    // members appended in group order — so g1,g2 precede a,b (g1) and d (g2).
    expect(expandSelectionWithGroupMembers(nodes, ['g1', 'g2'])).toEqual([
      'g1',
      'g2',
      'a',
      'b',
      'd',
    ]);
  });

  it('skips a childId that no longer resolves to an existing node (stale membership)', () => {
    const stale: GroupOpNode[] = [group('g', ['x', 'gone']), loose('x')];
    expect(expandSelectionWithGroupMembers(stale, ['g'])).toEqual(['g', 'x']);
  });

  it('preserves selection order, appending members after the groups', () => {
    expect(expandSelectionWithGroupMembers(nodes, ['c', 'g1'])).toEqual(['c', 'g1', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// M9 — clipboard paste childIds remap (design §9.4 — the single id-remap pass)
// ---------------------------------------------------------------------------
describe('remapGroupChildIds', () => {
  // Shape mirrors a pasted node: id already rewritten, data carried verbatim.
  interface PN {
    id: string;
    type?: string;
    data?: unknown;
  }

  it('rewrites a pasted group’s childIds through the id map', () => {
    const pasted: PN[] = [
      { id: 'g-new', type: 'group', data: { childIds: ['a-old', 'b-old'], name: 'G' } },
      { id: 'a-new', type: 'rectangle', data: {} },
      { id: 'b-new', type: 'rectangle', data: {} },
    ];
    const idMap = new Map([
      ['g-old', 'g-new'],
      ['a-old', 'a-new'],
      ['b-old', 'b-new'],
    ]);
    const out = remapGroupChildIds(pasted, idMap);
    expect((out[0]?.data as { childIds: string[] }).childIds).toEqual(['a-new', 'b-new']);
    // Other group data is preserved.
    expect((out[0]?.data as { name: string }).name).toBe('G');
  });

  it('drops childIds whose member was NOT copied (no dangling reference)', () => {
    // Group copied with only ONE of its two members in the paste.
    const pasted: PN[] = [
      { id: 'g-new', type: 'group', data: { childIds: ['a-old', 'b-old'] } },
      { id: 'a-new', type: 'rectangle', data: {} },
    ];
    const idMap = new Map([
      ['g-old', 'g-new'],
      ['a-old', 'a-new'],
    ]);
    const out = remapGroupChildIds(pasted, idMap);
    // b-old has no mapping → pruned; only a-new survives.
    expect((out[0]?.data as { childIds: string[] }).childIds).toEqual(['a-new']);
  });

  it('leaves non-group nodes untouched (by reference)', () => {
    const loose1: PN = { id: 'a-new', type: 'rectangle', data: { childIds: ['ignored'] } };
    const out = remapGroupChildIds([loose1], new Map());
    // A loose node that happens to carry a `childIds` field is NOT rewritten.
    expect(out[0]).toBe(loose1);
  });

  it('yields an empty childIds when none of the members were copied', () => {
    const pasted: PN[] = [{ id: 'g-new', type: 'group', data: { childIds: ['a-old', 'b-old'] } }];
    const out = remapGroupChildIds(pasted, new Map([['g-old', 'g-new']]));
    expect((out[0]?.data as { childIds: string[] }).childIds).toEqual([]);
  });

  it('is a SINGLE pass — no parent rewrites, the only field touched is childIds', () => {
    // The guardrail: a loose member node carries NO parentId field after remap.
    const pasted: PN[] = [
      { id: 'g-new', type: 'group', data: { childIds: ['a-old'] } },
      { id: 'a-new', type: 'rectangle', data: { label: 'x' } },
    ];
    const out = remapGroupChildIds(pasted, new Map([['a-old', 'a-new']]));
    expect(out[1]?.data).toEqual({ label: 'x' }); // member data unchanged, no parentId
  });
});

// ---------------------------------------------------------------------------
// M9 — delete policy + childIds prune ORDERING (design §9.3, §12.9)
// ---------------------------------------------------------------------------
describe('planGroupAwareDeletion', () => {
  const nodes: GroupOpNode[] = [
    group('g1', ['a', 'b', 'c']),
    loose('a'),
    loose('b'),
    loose('c'),
    loose('d'),
  ];

  it('deleting a GROUP releases its members (members NOT in deleteIds, no prune)', () => {
    const plan = planGroupAwareDeletion(nodes, ['g1']);
    expect(plan.deleteIds).toEqual(['g1']);
    // No prune: the group's childIds die with it (design §9.3, §12.9).
    expect(plan.childIdsPrunes).toEqual([]);
  });

  it('deleting a MEMBER prunes the owning group FIRST (childIds minus member)', () => {
    const plan = planGroupAwareDeletion(nodes, ['b']);
    // The prune drops b; a and c survive.
    expect(plan.childIdsPrunes).toEqual([{ groupId: 'g1', childIds: ['a', 'c'] }]);
    expect(plan.deleteIds).toEqual(['b']);
  });

  it('deleting MULTIPLE members of one group emits ONE prune with all survivors', () => {
    const plan = planGroupAwareDeletion(nodes, ['a', 'c']);
    expect(plan.childIdsPrunes).toEqual([{ groupId: 'g1', childIds: ['b'] }]);
    expect(new Set(plan.deleteIds)).toEqual(new Set(['a', 'c']));
  });

  it('deleting the last member leaves an empty group (childIds: []), not auto-deleted', () => {
    const single: GroupOpNode[] = [group('g', ['only']), loose('only')];
    const plan = planGroupAwareDeletion(single, ['only']);
    // design §9.11: empty group is allowed and persists; we only prune membership.
    expect(plan.childIdsPrunes).toEqual([{ groupId: 'g', childIds: [] }]);
    expect(plan.deleteIds).toEqual(['only']);
  });

  it('marquee spanning a group + its members: group deleted → no prune for it (moot)', () => {
    const plan = planGroupAwareDeletion(nodes, ['g1', 'a', 'b']);
    // The group is being deleted, so pruning it is moot (§12.9 dedupe).
    expect(plan.childIdsPrunes).toEqual([]);
    expect(new Set(plan.deleteIds)).toEqual(new Set(['g1', 'a', 'b']));
  });

  it('dedupes deleteIds (a member listed twice collapses)', () => {
    const plan = planGroupAwareDeletion(nodes, ['d', 'd']);
    expect(plan.deleteIds).toEqual(['d']);
    expect(plan.childIdsPrunes).toEqual([]);
  });

  it('a loose-only delete touches no group', () => {
    const plan = planGroupAwareDeletion(nodes, ['d']);
    expect(plan.childIdsPrunes).toEqual([]);
    expect(plan.deleteIds).toEqual(['d']);
  });

  it('no prune for a group that loses no member', () => {
    // Delete d (not a member of g1) → g1 keeps all members, no prune write.
    const plan = planGroupAwareDeletion(nodes, ['d', 'a']);
    expect(plan.childIdsPrunes).toEqual([{ groupId: 'g1', childIds: ['b', 'c'] }]);
  });
});
