# Review model → flows

Deterministic translation. One review model (`./review-model.md`) in, one set of laid-out flows
out. Follow it literally — two writers on the same model must produce the same canvas.

## 1. The flow set

| Flow slug | Emitted when | Holds |
|---|---|---|
| `main` | always | header panel, every lane, every element, every relation, nav strip |
| `sequence` | `model.sequence !== null` | one lane per participant, one card per message |
| `tour` | `walkthrough.length >= 2` | one card per step, one link per step stage |
| a slug derived from the view id | one per surviving `views[]` entry, roots and nested alike | that view's `scope` only |

**`main`, `sequence` and `tour` are reserved words used verbatim as slugs.** Nothing derives them
and nothing decorates them — `walkthrough[].stage: "sequence"` and `main`'s nav strip both target
them by name, and a slug like `send-sequence` strands every link that pointed at it.

Only a **view** slug is derived: lowercase the view id, replace each run of characters outside
`[a-z0-9]` with `-`, strip leading and trailing `-`; the result must match
`/^[a-z0-9][a-z0-9-]*$/`. A derived slug colliding with `main`, `sequence` or `tour` gets `-view`
appended. That transform is not invertible, so **every `kind: "view"` dispatch carries an explicit
`viewId` beside its `flowSlug`** — resolve your slice from `views[]` by `viewId`, never by
re-deriving an id from a slug.

**Cap: 6 flows per project.** Reserve `main`, then `sequence`, then `tour`. Fill what is left with
views depth-first (`views[]` order, each view's `children` before the next root). Views past the
budget are dropped, and so is every linkflow that pointed at one — an unlinked navigation card is
worse than no card.

You do not apply that cap yourself. The `flowPlan` you were given is the authoritative list of
flows that will exist; it was built in exactly the reservation order above. Link only to slugs
that appear in it, and if a flow you expected is missing, drop the link and log the drop in
`modelProblems` — never write a linkflow to a flow you hope exists.

**Nested views link from their parent, not from `main`.** `main`'s nav strip lists root views
only; a child view's linkflow lives on its parent's flow.

Ids are derived from the model, never invented — this is what makes two runs, and two writers
working in parallel on the same model, agree:

```
lane band   lane-<lane.id>-band     element card   el-<element.id>
lane header lane-<lane.id>-header   message card   msg-<message.id>
header panel pr-header              tour step      step-<step.id>
nav link    link-<targetFlowSlug>   relation       rel-<relation.id>
chain connector  chain-<i>  (sequence chain and tour spine, i = 1..n-1)
```

**Never call `$SEEFLOW ids`.** It mints random ids for hand-seeded flows; that is a different job,
and a minted id makes a cross-flow reference unresolvable the moment another writer needs to name
the same card. If two derived ids collide inside one flow, the model has duplicate ids — that is a
`modelProblems` entry, not something to paper over.

**On `tour` a step's link id is `link-<step.id>`, not `link-<targetFlowSlug>`.** Several steps
legitimately share a `stage`, and the slug form would mint the same id twice in one body —
`flow:add-bulk` rejects that with `duplicateIdInBatch`.

Ids are unique per flow, not per project: `el-checkout-route` appears in `main` and in every view
that scopes it, and that is correct.

One `flow:add-bulk` per flow. If a flow needs more than 100 nodes or 100 connectors the model is
too coarse — cut scope, don't split the call.

## 2. Node type by element kind

| `element.kind` | Node `type` | Suggested `data.icon` |
|---|---|---|
| `service` | `rectangle` | `server` |
| `app` | `rectangle` | `layout-dashboard` |
| `route` | `rectangle` | `route` (or `webhook` for an inbound hook) |
| `module` | `rectangle` | `file-code` |
| `function` | `rectangle` | `file-code` |
| `config` | `rectangle` | `settings` |
| `test` | `rectangle` | `list-checks` |
| `other` | `rectangle` | `box` |
| `job` | `server` | `timer` |
| `queue` | `queue` | — the shape is the glyph |
| `datastore` | `database` | — the shape is the glyph |
| `cache` | `database` | `zap` |
| `external` | `cloud` | — the shape is the glyph |
| `ui` | `rectangle` | `monitor` |
| `actor` | `user` | — the shape is the glyph |

`data.icon` is optional, unprefixed Lucide kebab-case only. A wrong guess renders a `?`, which is
worse than no icon — unsure means omit. Illustrative shapes already carry a glyph.

## 3. The delta channel

The one rule that makes the canvas readable at a glance. Every element in every flow carries its
delta as colour.

| `delta` | `data.borderColor` | `data.borderStyle` | `data.borderSize` |
|---|---|---|---|
| `added` | `green` | `solid` | 2 |
| `modified` | `amber` | `solid` | 2 |
| `removed` | `red` | `dashed` | 2 |
| `unchanged` | `slate` | `solid` | 1 |

Connectors take the same three values under their own key names — `color`, `style`, `borderSize`.

**Where the visual fields live.** On a node they go inside `data` (`width`, `height`,
`borderColor`, `borderStyle`, `borderSize`, `fontSize`, `textAlign`); only `id`, `type` and
`position` are top-level. On a connector they are all top-level (`color`, `style`, `borderSize`,
`direction`, `path`, `animated`) — a connector has no `data` object at all. Get this backwards and
`flow:add-bulk` answers `badSchema`.

- **The four tokens are reserved.** No element and no relation takes `green`, `amber` or `red` for
  any reason other than its delta. Lane bands and headers use `gray`, so chrome never reads as a
  change. `slate` is the neutral token: unchanged elements, muted relations, tour spine.
- **Colour is never the only channel.** `data.description` opens with the delta word, an em dash,
  then the element's `subtitle` — `"added — every 10s, 500 per batch"`. Under 15 words; the card
  clips. No `subtitle` still means the delta word plus a phrase you write from `detail`.

## 4. Emphasis and animation

| `relation.emphasis` | Connector |
|---|---|
| `hero` | delta colour and style, `borderSize: 3`, `animated: true` |
| `normal` | delta colour, style and size from §3 |
| `muted` | `color: "slate"`, `style: "dotted"`, `borderSize: 1` — delta is not drawn |

**At most two `animated` connectors per flow outside `sequence`.** If the model marks three
relations `hero`, keep the two earliest in `relations[]` and demote the rest to `normal`.

```json
{ "id": "rel-route-enqueues", "source": "el-checkout-route", "target": "el-receipt-queue",
  "label": "1 job per order", "color": "green", "style": "solid", "borderSize": 3,
  "animated": true, "direction": "forward", "path": "curve" }
```

In the `sequence` flow every chain connector is animated, because there the movement *is* the
content — the marching dashes read as step order. Nowhere else: motion is the loudest thing on a
canvas, and three animated lines tell the reader nothing about which one the change is about.

## 5. Geometry

Nothing auto-places. A node with no `position` lands at `(0,0)` with every other node.

```
LANE_W 360   LANE_GUTTER 40   LANE_TOP 0   LANE_HEADER_H 56   CARD_W 300
CARD_H 96    CARD_GAP 40      CARD_X_INSET 30
BAND_PAD_BOTTOM 40   // sits on top of the trailing CARD_GAP: 80px of clear
                     // space below the last card, by design
```

1. Order lanes by `lane.order`, ties broken by `lanes[]` order. Lane index `k` starts at 0.
2. `laneX = k * (LANE_W + LANE_GUTTER)`; `rows` = cards in that lane in this flow.
3. `bandHeight = LANE_HEADER_H + rows * (CARD_H + CARD_GAP) + BAND_PAD_BOTTOM` — that is
   `96 + rows * 136`.
4. Band = `group` at `(laneX, LANE_TOP)`, `data.width: LANE_W`, `data.height: bandHeight`.
5. Header = `text` at `(laneX + CARD_X_INSET, LANE_TOP + 12)`, `data.width: CARD_W`,
   `data.height: 32`.
6. Card `i` at `(laneX + CARD_X_INSET, LANE_TOP + LANE_HEADER_H + i * (CARD_H + CARD_GAP))`,
   `data.width: CARD_W`, `data.height: CARD_H`. Cards keep their `elements[]` order within the lane.
7. `maxBandBottom = LANE_TOP + max(bandHeight)` across lanes — the nav strip's anchor.

**Worked example — the model in `review-model.md`, 3 lanes with 3 / 3 / 1 cards.**

`laneX` = 0, 400, 800. `bandHeight` = 504, 504, 232 (`96 + 3*136`, `96 + 3*136`, `96 + 1*136`).
`maxBandBottom` = 504. Card rows sit at `y` = 56, 192, 328 (`56 + i*136`) in every lane.

| Node | type | position | data.width × data.height |
|---|---|---|---|
| `lane-request-band` | `group` | (0, 0) | 360 × 504 |
| `lane-request-header` | `text` | (30, 12) | 300 × 32 |
| `el-checkout-route` | `rectangle` | (30, 56) | 300 × 96 |
| `el-orders-db` | `database` | (30, 192) | 300 × 96 |
| `el-inline-sender` | `rectangle` | (30, 328) | 300 × 96 |
| `lane-async-band` | `group` | (400, 0) | 360 × 504 |
| `lane-async-header` | `text` | (430, 12) | 300 × 32 |
| `el-receipt-queue` | `queue` | (430, 56) | 300 × 96 |
| `el-receipt-worker` | `server` | (430, 192) | 300 × 96 |
| `el-mail-client` | `rectangle` | (430, 328) | 300 × 96 |
| `lane-external-band` | `group` | (800, 0) | 360 × 232 |
| `lane-external-header` | `text` | (830, 12) | 300 × 32 |
| `el-mail-provider` | `cloud` | (830, 56) | 300 × 96 |

**Band.** `data.childIds` lists that lane's card ids, in row order — never the header, never a card
from another lane, never a band (a group may not contain a group). Membership lives nowhere else:
omit `childIds` and it defaults to `[]`, which leaves the band a painted rectangle that happens to
sit behind some cards — selecting or dragging it moves the frame off the cards it was drawn around,
and deleting it silently orphans nothing because it owned nothing.

```json
{ "id": "lane-async-band", "type": "group", "position": { "x": 400, "y": 0 },
  "data": { "name": "Background",
            "childIds": ["el-receipt-queue", "el-receipt-worker", "el-mail-client"],
            "width": 360, "height": 504, "borderColor": "gray", "borderSize": 1 } }
```

Dragging a band moves the band and exactly its `childIds` members, so the `text` header — which is
never a member — stays behind and the lane label desyncs. Say in your closing line that the lane
bands are laid out, not draggable furniture.

**Header.** A band renders no visible label, so the header text node is what names the lane. `name`
is `lane.label`; when `lane.subtitle` is set, `name` is `"<label> · <subtitle>"`.

```json
{ "id": "lane-async-header", "type": "text", "position": { "x": 430, "y": 12 },
  "data": { "name": "Background · queue + worker", "width": 300, "height": 32,
            "fontSize": 18, "textAlign": "left", "borderColor": "gray" } }
```

**Card.** Every field below is required of you; nothing else is.

```json
{ "id": "el-receipt-worker", "type": "server", "position": { "x": 430, "y": 192 },
  "data": { "name": "receipt worker", "icon": "timer", "detail": "…markdown, see §7…",
            "description": "added — every 10s, 500 per batch",
            "width": 300, "height": 96,
            "borderColor": "green", "borderStyle": "solid", "borderSize": 2 } }
```

## 6. Per-flow recipes

### `main`

1. **Header panel** — one `component` node, id `pr-header`, at `(0, LANE_TOP - 200)`,
   `data.width = nLanes * LANE_W + (nLanes - 1) * LANE_GUTTER` (3 lanes ⇒ 1160),
   `data.height: 160`. A `Card` root titled `model.title`, a muted `Text` carrying `model.summary`,
   a muted `Text` reading `"<pr.filesChanged> files  +<pr.additions>  -<pr.deletions>"`, then one
   `Metric` per `model.chips` entry. `chip.tone` has no home on `Metric` — drop it, don't invent a
   prop. `Card`, `Text` and `Metric` are catalog components; `spec` is inline at `data.spec`.

   ```json
   { "id": "pr-header", "type": "component", "position": { "x": 0, "y": -200 },
     "data": { "name": "Receipt mail moves off the request path", "width": 1160, "height": 160,
       "spec": { "root": "card", "elements": {
         "card":   { "type": "Card", "props": { "title": "Receipt mail moves off the request path" }, "children": ["lede", "counts", "chip0"] },
         "lede":   { "type": "Text", "props": { "text": "<model.summary>", "muted": true } },
         "counts": { "type": "Text", "props": { "text": "11 files  +402  -168", "muted": true } },
         "chip0":  { "type": "Metric", "props": { "label": "Provider calls", "value": "500x fewer" } } } } } }
   ```

2. **Lane bands and headers** for every lane in `model.lanes` (§5).
3. **Every element** in `model.elements` as a card in its `lane` (§2, §3, §5).
4. **Every relation** in `model.relations` as a connector `rel-<relation.id>` from
   `el-<relation.from>` to `el-<relation.to>` (§3, §4), `label` = `relation.label`,
   `direction: "forward"`, `path: "curve"`.
5. **Nav strip** — one `linkflow` per child flow named in `flowPlan` (root views, then `sequence`,
   then `tour`), in a row at `y = maxBandBottom + 80`, the `j`-th at
   `x = j * (LANE_W + LANE_GUTTER)`, `data.width: 300`, `data.height: 132`. `data.name` = the
   target flow's `flowPlan` title, `data.detail` = the target view's `purpose` (for `sequence`,
   `sequence.title`; for `tour`, "Guided walkthrough, N steps"). `data.target.project` is the
   project slug you were given.

   ```json
   { "id": "link-send-path", "type": "linkflow", "position": { "x": 0, "y": 584 },
     "data": { "name": "How a receipt gets sent",
               "detail": "The path from checkout to the provider, with the retired inline call left in so the swap is visible.",
               "width": 300, "height": 132,
               "target": { "project": "pr-2841-storefront", "flow": "send-path" } } }
   ```

### View flows

Same geometry, narrower content. No header panel. Resolve your slice from `views[]` by the
`viewId` you were given, not by the flow slug.

- Draw `view.scope.elements`. For relations: when `view.scope.relations` is non-empty, draw exactly
  those, dropping any whose endpoint is out of scope and logging each drop in `modelProblems`; when
  it is empty, draw every relation whose `from` and `to` are both in scope — the induced picture.
- Keep lane identity, drop empty lanes, then **re-index `k` over the survivors** so the columns are
  contiguous. A gap where a lane used to be reads as a missing lane.
- **Back-link:** a `linkflow` at `(0, LANE_TOP - 172)`, `data.width: 300`, `data.height: 132`,
  `data.name` = `"Back to the change map"`, target flow `main`.
- Child views: one `linkflow` each on that same row, the `j`-th at
  `x = j * (LANE_W + LANE_GUTTER)` — the back-link occupies `j = 0`.

### `sequence`

- Lanes are `sequence.participants` in array order — participant `k` is lane `k`.
- `lane.order` does not apply here; array order **is** the order, and there is no `lanes[]` object
  to read. Band and header geometry are §5's, but the header `name` comes from the participant's
  element: `element.label`, plus `" · " + element.subtitle` when it has one. Band ids are
  `lane-<participantElementId>-band`, headers `lane-<participantElementId>-header`.
- One card per `sequence.messages` entry, in the **receiver's** lane (`message.to`) at
  `row = index`. Size every band with `rows = messages.length`, so row `i` sits at the same `y` in
  every lane and the chain reads straight across.
- Card `type` follows the receiving participant's element kind (§2). `data.name` = `message.label`;
  `data.description` = `"<delta> — step <i+1>, <from> → <to>"`; `data.detail` = `message.note`;
  colour from `message.delta` (§3).
- Chain: connector `chain-<i>` from `msg-<messages[i-1].id>` to `msg-<messages[i].id>`, for
  `i = 1..n-1`, `label` = `"<i+1> · <messages[i].label>"`, every one `animated: true`.
- `kind: "return"` draws its incoming connector `style: "dashed"`; delta still owns the colour.
- A self message (`from === to`) is a card in that one lane like any other — the chain runs into it
  and out of it unbroken. Never skip it in the numbering.
- Back-link at `(0, LANE_TOP - 172)`, exactly as for view flows.

### `tour`

- One column. Step `i` is a `rectangle` with id `step-<step.id>` at `(0, i * (CARD_H + CARD_GAP))`
  — `(0, i * 136)` — `data.width: 420` (`CARD_W * 1.4`), `data.height: 96`. Border `slate`,
  `solid`, `1` — steps are narration, not change.
- `data.name` = `"<i+1> · <step.heading>"`; `data.description` = `step.body`.
- `data.detail` = `step.body`, a blank line, then a `### Read this` list — one line per id in
  `step.focus`. For an element: its `label`, an em dash, then its `files[]` as blob links built per
  §7, line fragment included. For a relation: `"<from label> → <to label>"` and the relation's
  `label`. An element with no files contributes its label alone. An id absent from the model is
  dropped, not guessed at; a step whose entire focus drops loses its card and its spine connector,
  and the steps after it renumber. A reviewer should be able to go from step 1 to the first line of
  code without opening anything else — a step that names no file has not done that.
- Beside each step, a `linkflow` with id `link-<step.id>` to that step's `stage` flow at
  `(CARD_W * 1.4 + LANE_GUTTER, i * (CARD_H + CARD_GAP))` — `(460, i * 136)` — `data.width: 300`,
  `data.height: 132`. `stage` names a **view id**, not a flow slug: run it through §1's slug
  derivation (including the `-view` collision suffix) before matching it against `flowPlan`.
  `"main"` and `"sequence"` are the two literal stage values that are already slugs. A step whose
  stage flow the §1 cap trimmed gets no link. `stage` is required by the model contract — a step
  missing one is a `modelProblems` entry *and* no link, never a guess.
- Spine: connector `chain-<i>` from step card `i-1` to step card `i`, `color: "slate"`,
  `style: "solid"`, `borderSize: 1`, `direction: "forward"`, no label, not animated.
- Back-link at `(0, LANE_TOP - 172)`.

## 7. Detail panels

`data.detail` is markdown in the right-hand panel: GFM tables, lists, links and mermaid fences
render; fenced code renders as plain monospace with no highlighting — short excerpts only, never a
diff hunk.

**Element card** — `element.detail` verbatim, then any inbound relation detail (below), then the
file list, then (unchanged elements only) one closing line. All three optional parts shown together
here:

```markdown
<element.detail>

### 1 job per order
The whole point of the change: the request path now ends here instead of at the provider.

### Files
- [src/workers/receipt-worker.ts](https://github.com/acme/storefront/blob/9c1f0ab/src/workers/receipt-worker.ts#L120-L186) — claims and sends the batch
- [src/mail/send-receipt-now.ts](https://github.com/acme/storefront/blob/4471de2/src/mail/send-receipt-now.ts) — deleted here

**Why it is here** — the queue this change now fills; untouched by the diff.
```

Link form is `https://github.com/<pr.repo>/blob/<sha>/<path><frag>`, where `<sha>` is `pr.baseSha`
when the file entry carries `gone: true` and `pr.headSha` otherwise — decided **per file, never per
element**, because a `modified` element routinely deletes one of its files — and `<frag>` is
`#L<start>-L<end>` when the entry carries `lines`, empty otherwise. `pr.baseSha` is the merge base,
so a link built from it shows the file as the pull request found it. Do **not** build
`<pr.url>/files#diff-…` anchors: that fragment is a hash of the path, not the path, so a
hand-built one lands nowhere.

**`relation.detail` has a home even so.** When a relation carries `detail`, append it to the
`data.detail` of the element it points **at** (`relation.to`), under a `### <relation.label>`
heading, after that element's own detail and before its file list. A hero relation's detail is the
sentence the reviewer most needs; dropping it because connectors have no panel loses the point of
the change.

**Sequence card** — `message.note`, plus the same file list when the message carries files.
**Header panel and lane header** — no detail; the panel's content is its `spec`, and a `text` node
never opens the panel at all. The studio still scaffolds an empty `nodes/<id>/detail.md` and a
`data.detail: "file://detail.md"` for every node it accepts, band and header included. Seeing one
on read-back is normal — do not patch it away.

**Connectors have no detail panel.** Selecting one shows a read-only summary of its own fields.
Anything a relation needs to say goes in its `label`, or into the `detail` of the node it points at
per the rule above. Do not park prose on a connector expecting a reader to find it.

## 8. Cheap self-check before you hand the flow over

Run this on your own `flow:add-bulk` body, per flow. You authored every id and every position, so
the body is the truth — this list is entirely computable from it and needs no read-back.

1. Every node `id` appears exactly once, and every id is derived per §1 — none invented, none
   minted.
2. Every connector `source` and `target` names a node in the same body.
3. No two nodes share a `position`.
4. Every card sits inside its band: `laneX + CARD_X_INSET` to `laneX + 330` horizontally, above
   `LANE_TOP + bandHeight - BAND_PAD_BOTTOM` vertically.
5. `nodes.length <= 100` and `connectors.length <= 100`.
6. At most two `animated: true` connectors outside the `sequence` flow.
7. Every `linkflow` `target.flow` is a slug that appears in the `flowPlan` you were given; every
   `target.project` is the project slug you were given.
8. No node or connector carries a key the schema does not name. Check a **semantic** field with
   `$SEEFLOW schema node <type>` and a **visual** one with `$SEEFLOW schema style` — `schema node`
   and `schema connector` return only the on-disk semantic shape (`name` / `description` / `detail`
   / `icon`, and `id` / `source` / `target` / `label` / metadata) and deliberately hide every
   position, size, colour, border, `path`, `direction` and `animated` field. One further
   exception: `$SEEFLOW schema node group` answers `notFound` — the band type is missing from the
   CLI's subname list, not from the schema. `type: "group"` is valid and its `data` accepts `name`,
   `childIds`, `width`, `height`, `borderColor`, `borderSize`, `backgroundColor` and
   `cornerRadius`. Do not substitute another type; do not treat the error as a verdict.
9. Every card is an endpoint of at least one connector in this body. An orphan card is a
   `modelProblems` entry, not a card you draw quietly.
10. Every band's `childIds` names exactly its own cards, in row order, and every card is named by
    exactly one band.

The only thing worth reading back is that it landed, as counts — never the whole flow document.

## 9. Red flags — stop and reconsider

If you catch yourself thinking any of the following, you are rationalising.

- "The spacing looks off, I'll run `flows:layout` just to tidy it." → no. It rewrites `style.json`
  with positions only: every width, height and colour you authored is gone, and the lane bands are
  ejected into a junk column on the right. §5 *is* the layout.
- "The user can just hit Tidy if they want it neater." → Tidy runs the same layout through the
  adapter and destroys the same authored geometry. Tell the user the flow is hand-laid-out and
  Tidy will flatten it; never press it yourself.
- "I'll leave positions off and let the canvas place things." → nothing places anything. Every node
  with no `position` renders at `(0,0)`, stacked on every other one.
- "The band has a `name`, so the lane is labelled." → it is not. A group paints a border and
  nothing else; the name reaches screen readers only. A band with no `text` header is an anonymous
  rectangle.
- "This element is a security fix, I'll make it orange so it stands out." → the colour channel
  means delta and only delta. Loudness that is not a change hides the changes.
- "The model gave me five lanes, I'll draw five." → four is the ceiling, three usually reads
  better. Two of the five are almost always the same boundary at different zoom — merge them and
  let the finer split live in the cards' `subtitle`.
- "Three relations are marked hero, they all matter." → then none of them does. Two animated lines
  at most; demote the rest to `normal`.
- "I need an id for this and the table does not give me one." → then the model is missing an
  element. Say so in `modelProblems`; do not mint one.
