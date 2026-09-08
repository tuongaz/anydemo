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

**The illustrative shapes — `queue`, `database`, `cloud`, `user` — draw their label outside the
frame**, centred under or beside the glyph, and the label does not wrap to the node's width. At
`CARD_W` 300 that means **≤20 characters**, and a longer label runs across the lane gutter into the
next lane's cards. When an element of one of those kinds has a label longer than 20 characters, draw
it as a `rectangle` and put the shape's meaning in the icon instead (`queue` ⇒ `inbox`, `datastore`
/ `cache` ⇒ `database`, `external` ⇒ `cloud`, `actor` ⇒ `user`). The lane grid is the thing that
must hold; the glyph is a nicety.

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
LANE_W 360   LANE_GUTTER 40   LANE_TOP 0   LANE_HEADER_H 88   CARD_W 300
CARD_H 160   CARD_GAP 40      CARD_X_INSET 30   HEADER_TEXT_H 64
LINK_W 300   LINK_H 160
BAND_PAD_BOTTOM 40   // sits on top of the trailing CARD_GAP: 80px of clear
                     // space below the last card, by design
```

These numbers are **measured**, not chosen: a card holding a wrapped title plus one line of
description renders 156px tall, a `linkflow` renders 153px, and a lane header that wraps to two
lines renders 57px. Every constant above is the next round number above what the canvas actually
paints. Do not shave them to tighten the picture — a node authored shorter than its content does
not scroll and does not clip, it paints over its neighbour.

**Every position and every size is an integer.** A fractional `y` is a sign you computed a
layout instead of following one; round-tripping it through `style.json` also makes two runs of the
same model disagree on ids' geometry, which is the one thing this mapping exists to prevent.

**Nothing clips and nothing auto-grows.** A node renders its text at the size you authored and
paints straight over its neighbours when the text does not fit — the canvas has no ellipsis and no
reflow-to-fit. That is why the caps below are caps and not suggestions:

| Field | Cap | Why |
|---|---|---|
| card `data.name` | ≤34 chars, one line | 300px at the card title size fits ~34 characters. |
| card `data.description` | ≤72 chars, one line of prose | Two lines of body is the most a 160px card holds under a wrapped title. |
| lane header `data.name` | ≤42 chars | `"<label> · <subtitle>"` when that fits in 42, **`label` alone when it does not** — a wrapped lane header paints over the first card. |

Everything you had to cut goes in `data.detail`, which scrolls in the inspector panel and is the
one place text is allowed to be long.

1. Order lanes by `lane.order`, ties broken by `lanes[]` order. Lane index `k` starts at 0.
2. `laneX = k * (LANE_W + LANE_GUTTER)`; `rows` = cards in that lane in this flow.
3. `bandHeight = LANE_HEADER_H + rows * (CARD_H + CARD_GAP) + BAND_PAD_BOTTOM` — that is
   `128 + rows * 200`.
4. Band = `group` at `(laneX, LANE_TOP)`, `data.width: LANE_W`, `data.height: bandHeight`.
5. Header = `text` at `(laneX + CARD_X_INSET, LANE_TOP + 12)`, `data.width: CARD_W`,
   `data.height: HEADER_TEXT_H` (64) — two lines of clearance, so a label that wraps still lands
   above the first card rather than on it.
6. Card `i` at `(laneX + CARD_X_INSET, LANE_TOP + LANE_HEADER_H + i * (CARD_H + CARD_GAP))`,
   `data.width: CARD_W`, `data.height: CARD_H`. Cards keep their `elements[]` order within the lane.
7. `maxBandBottom = LANE_TOP + max(bandHeight)` across lanes — the nav strip's anchor.

**Worked example — the model in `review-model.md`, 3 lanes with 3 / 3 / 1 cards.**

`laneX` = 0, 400, 800. `bandHeight` = 728, 728, 328 (`128 + 3*200`, `128 + 3*200`, `128 + 1*200`).
`maxBandBottom` = 728. Card rows sit at `y` = 88, 288, 488 (`88 + i*200`) in every lane.

| Node | type | position | data.width × data.height |
|---|---|---|---|
| `lane-request-band` | `group` | (0, 0) | 360 × 728 |
| `lane-request-header` | `text` | (30, 12) | 300 × 64 |
| `el-checkout-route` | `rectangle` | (30, 88) | 300 × 160 |
| `el-orders-db` | `database` | (30, 288) | 300 × 160 |
| `el-inline-sender` | `rectangle` | (30, 488) | 300 × 160 |
| `lane-async-band` | `group` | (400, 0) | 360 × 728 |
| `lane-async-header` | `text` | (430, 12) | 300 × 64 |
| `el-receipt-queue` | `queue` | (430, 88) | 300 × 160 |
| `el-receipt-worker` | `server` | (430, 288) | 300 × 160 |
| `el-mail-client` | `rectangle` | (430, 488) | 300 × 160 |
| `lane-external-band` | `group` | (800, 0) | 360 × 328 |
| `lane-external-header` | `text` | (830, 12) | 300 × 64 |
| `el-mail-provider` | `cloud` | (830, 88) | 300 × 160 |

A `user`, `cloud`, `queue` or `database` card draws a glyph the plain rectangle does not, and
renders ~24px taller for the same text. `CARD_H` is 160 for **every** card so the rows stay level
across lanes — never size a card to its own type.

**Band.** `data.childIds` lists that lane's card ids, in row order — never the header, never a card
from another lane, never a band (a group may not contain a group). Membership lives nowhere else:
omit `childIds` and it defaults to `[]`, which leaves the band a painted rectangle that happens to
sit behind some cards — selecting or dragging it moves the frame off the cards it was drawn around,
and deleting it silently orphans nothing because it owned nothing.

```json
{ "id": "lane-async-band", "type": "group", "position": { "x": 400, "y": 0 },
  "data": { "name": "Background",
            "childIds": ["el-receipt-queue", "el-receipt-worker", "el-mail-client"],
            "width": 360, "height": 728, "borderColor": "gray", "borderSize": 1 } }
```

Dragging a band moves the band and exactly its `childIds` members, so the `text` header — which is
never a member — stays behind and the lane label desyncs. Say in your closing line that the lane
bands are laid out, not draggable furniture.

**Header.** A band renders no visible label, so the header text node is what names the lane. `name`
is `lane.label`; when `lane.subtitle` is set and `"<label> · <subtitle>"` is **≤42 characters**,
`name` is that string. Past 42 the subtitle is dropped and `name` is the label alone — the subtitle
is already in the cards, and a third line of header lands on the first one.

```json
{ "id": "lane-async-header", "type": "text", "position": { "x": 430, "y": 12 },
  "data": { "name": "Background · queue + worker", "width": 300, "height": 64,
            "fontSize": 18, "textAlign": "left", "borderColor": "gray" } }
```

**Card.** Every field below is required of you; nothing else is.

```json
{ "id": "el-receipt-worker", "type": "server", "position": { "x": 430, "y": 288 },
  "data": { "name": "receipt worker", "icon": "timer", "detail": "…markdown, see §7…",
            "description": "added — every 10s, 500 per batch",
            "width": 300, "height": 160,
            "borderColor": "green", "borderStyle": "solid", "borderSize": 2 } }
```

`name` is the element's `label` trimmed to 34 characters, `description` is one line of ≤72 —
`"<delta> — <one clause>"`. Anything longer belongs in `detail`; a two-sentence description paints
over the card below it.

## 6. Per-flow recipes

### `main`

1. **Header panel** — one `component` node, id `pr-header`, spanning the lanes:
   `data.width = nLanes * LANE_W + (nLanes - 1) * LANE_GUTTER` (3 lanes ⇒ 1160).

   **Its height is computed, not fixed, and it is authored above the lanes with real clearance:**

   ```
   HEADER_H = 300 + 48 * chips.length      // integer; 3 chips ⇒ 444, 5 ⇒ 540, none ⇒ 300
   pr-header position = (0, LANE_TOP - (HEADER_H + 60))
   ```

   Those numbers are measured against the real render: a card title, a three-line lede, the counts
   line and a five-row table come to 528px. The formula is deliberately generous — the panel sits
   above the lanes, so spare height costs a reviewer nothing and a shortfall costs them the map.

   A component paints its content at full size and **spills straight over whatever is beneath it**
   — it neither scrolls nor clips. A panel authored shorter than its content is the single most
   destructive thing you can do to this canvas: the chips land on the lane headers and the first
   row of cards, and the map is unreadable. Compute the height, then leave the 60px gap.

   The spec is a `Card` root titled `model.title`, with exactly three children:

   - `lede` — a muted `Text` carrying the **first two sentences** of `model.summary`, ≤240
     characters. The whole summary is not a caption; it goes in `data.detail`, which the inspector
     panel scrolls.
   - `counts` — a muted `Text` reading `"<pr.filesChanged> files  +<pr.additions>  -<pr.deletions>"`.
   - `chips` — **one `Table`**, columns `[{key:"label",label:"What changed"},{key:"value",label:""}]`,
     one row per `model.chips` entry (`{label, value}`). A `Table` is bounded — one row is one row
     — where a stack of `Metric`s is not: each `Metric` renders a headline-sized value, and five of
     them are taller than the whole map's header band. Emit no chips block at all when
     `chips` is `[]`, and `HEADER_H` falls out of the formula at `300`.

   `chip.tone` has no home on `Table` — drop it, don't invent a prop. `Card`, `Text` and `Table`
   are catalog components; `spec` is inline at `data.spec`.

   ```json
   { "id": "pr-header", "type": "component", "position": { "x": 0, "y": -504 },
     "data": { "name": "Receipt mail moves off the request path", "width": 1160, "height": 444,
       "detail": "<the full model.summary, as markdown>",
       "spec": { "root": "card", "elements": {
         "card":   { "type": "Card", "props": { "title": "Receipt mail moves off the request path" }, "children": ["lede", "counts", "chips"] },
         "lede":   { "type": "Text", "props": { "text": "POST /checkout used to call the mail provider inline, so a slow provider slowed checkout. The route now writes one job to the receipts queue and returns.", "muted": true } },
         "counts": { "type": "Text", "props": { "text": "11 files  +402  -168", "muted": true } },
         "chips":  { "type": "Table", "props": {
             "columns": [{ "key": "label", "label": "What changed" }, { "key": "value", "label": "" }],
             "rows": [{ "label": "Provider calls", "value": "500x fewer" },
                      { "label": "Provider round-trips", "value": "off the request path" },
                      { "label": "Inline sender", "value": "deleted" }] } } } } } }
   ```

2. **Lane bands and headers** for every lane in `model.lanes` (§5).
3. **Every element** in `model.elements` as a card in its `lane` (§2, §3, §5).
4. **Every relation** in `model.relations` as a connector `rel-<relation.id>` from
   `el-<relation.from>` to `el-<relation.to>` (§3, §4), `label` = `relation.label`,
   `direction: "forward"`, `path: "curve"`.
5. **Nav strip** — one `linkflow` per child flow named in `flowPlan` (root views, then `sequence`,
   then `tour`), in a row at `y = maxBandBottom + 80`, the `j`-th at
   `x = j * (LANE_W + LANE_GUTTER)`, `data.width: LINK_W`, `data.height: LINK_H` (160). `data.name` = the
   target flow's `flowPlan` title, `data.detail` = the target view's `purpose` (for `sequence`,
   `sequence.title`; for `tour`, "Guided walkthrough, N steps"). `data.target.project` is the
   project slug you were given.

   ```json
   { "id": "link-send-path", "type": "linkflow", "position": { "x": 0, "y": 808 },
     "data": { "name": "How a receipt gets sent",
               "detail": "The path from checkout to the provider, with the retired inline call left in so the swap is visible.",
               "width": 300, "height": 160,
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
- **Back-link:** a `linkflow` at `(0, LANE_TOP - 200)`, `data.width: LINK_W`, `data.height: LINK_H`,
  `data.name` = `"Back to the change map"`, target flow `main`.
- Child views: one `linkflow` each on that same row, the `j`-th at
  `x = j * (LANE_W + LANE_GUTTER)` — the back-link occupies `j = 0`.

### `sequence`

- Lanes are `sequence.participants` in array order — participant `k` is lane `k`.
- `lane.order` does not apply here; array order **is** the order, and there is no `lanes[]` object
  to read. Band and header geometry are §5's, but the header `name` comes from the participant's
  element: `element.label`, plus `" · " + element.subtitle` when it has one **and the joined string
  is ≤42 characters** — past that, the label alone, exactly as in §5. Band ids are
  `lane-<participantElementId>-band`, headers `lane-<participantElementId>-header`.
- One card per `sequence.messages` entry, in the **receiver's** lane (`message.to`) at
  `row = index`. Size every band with `rows = messages.length`, so row `i` sits at the same `y` in
  every lane and the chain reads straight across.
- Card `type` follows the receiving participant's element kind (§2). `data.name` =
  `message.label` trimmed to 34 characters; `data.description` = `"<delta> · step <i+1>"` and
  nothing more; `data.detail` = `message.note`; colour from `message.delta` (§3).

  The sender and receiver are already drawn — the card sits in the receiver's lane and the chain
  connector comes from the sender's. Repeating `"<from> → <to>"` in the description spends the
  card's second line restating its own position, and on long participant ids it overflows.
- Chain: connector `chain-<i>` from `msg-<messages[i-1].id>` to `msg-<messages[i].id>`, for
  `i = 1..n-1`, `label` = `"<i+1> · <messages[i].label>"`, every one `animated: true`.
- `kind: "return"` draws its incoming connector `style: "dashed"`; delta still owns the colour.
- A self message (`from === to`) is a card in that one lane like any other — the chain runs into it
  and out of it unbroken. Never skip it in the numbering.
- Back-link at `(0, LANE_TOP - 200)`, exactly as for view flows.

### `tour`

- One column. Step `i` is a `rectangle` with id `step-<step.id>` at `(0, i * (STEP_H + CARD_GAP))`
  — `STEP_H` is **156** and the pitch is 196, so `(0, i * 196)` — `data.width: 420`
  (`CARD_W * 1.4`), `data.height: 156`. Border `slate`, `solid`, `1` — steps are narration, not
  change.
- `data.name` = `"<i+1> · <step.heading>"`, ≤48 characters including the number: the heading wraps
  to two lines at 420px and a third line lands on the body.
- `data.description` = the **first sentence** of `step.body`, ≤120 characters. A step card is a
  headline, not the paragraph; the whole body is one click away in `detail` (below), and a body
  pasted whole overflows the card and paints over the next step.
- `data.detail` = `step.body`, a blank line, then a `### Read this` list — one line per id in
  `step.focus`. For an element: its `label`, an em dash, then its `files[]` as blob links built per
  §7, line fragment included. For a relation: `"<from label> → <to label>"` and the relation's
  `label`. An element with no files contributes its label alone. An id absent from the model is
  dropped, not guessed at; a step whose entire focus drops loses its card and its spine connector,
  and the steps after it renumber. A reviewer should be able to go from step 1 to the first line of
  code without opening anything else — a step that names no file has not done that.
- Beside a step, a `linkflow` with id `link-<step.id>` to that step's `stage` flow at
  `(CARD_W * 1.4 + LANE_GUTTER, i * (STEP_H + CARD_GAP))` — `(460, i * 196)` — `data.width: LINK_W`,
  `data.height: LINK_H`. `data.name` is short and fixed by kind — `"Open the change map"` for
  `main`, `"Open the sequence"` for `sequence`, `"Open <view title>"` for a view, ≤40 characters —
  and `data.detail` is the step's heading, so the card says which step it belongs to. Never paste
  the pull request's title into a link card: it is long, it wraps, and it is the same on every one.

  The back-link on `main`'s children follows the same rule: `"Back to the change map"`.

  **Only the first step of a run of steps sharing a stage gets one.** Emit the link when
  `step.stage` differs from the previous step's stage (and always for step 1); the steps after it
  in the same run get no link and no gap filled — the link is a change of scene, and six identical
  "Open the change map" cards down the right-hand column is noise a reviewer has to read past.

  `stage` names a **view id**, not a flow slug: run it through §1's slug derivation (including the
  `-view` collision suffix) before matching it against `flowPlan`. `"main"` and `"sequence"` are
  the two literal stage values that are already slugs. A step whose stage flow the §1 cap trimmed
  gets no link. `stage` is required by the model contract — a step missing one is a `modelProblems`
  entry *and* no link, never a guess.
- Spine: connector `chain-<i>` from step card `i-1` to step card `i`, `color: "slate"`,
  `style: "solid"`, `borderSize: 1`, `direction: "forward"`, no label, not animated.
- Back-link at `(0, LANE_TOP - 200)`.

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
11. **Nothing overflows its box.** Every card `data.name` ≤34 chars, every card
    `data.description` ≤72 chars on one line, every lane header `data.name` ≤42, every tour step
    `name` ≤48 and `description` ≤120. The canvas neither clips nor reflows: a string past its cap
    is painted over the node beneath it, and the reviewer reads two texts on top of each other.
12. **The header panel clears the lanes.** `pr-header`'s height is the computed `HEADER_H`, and
    its `y` is `LANE_TOP - (HEADER_H + 60)`. A panel sized by guess lands on the first row of
    cards.
13. **Every position and size is an integer.** No fractions anywhere in the body.

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
- *"The summary is good prose — I'll put all of it in the header panel."* → the panel does not
  scroll and does not clip. Two sentences on the card, the rest in `detail`. The same rule governs
  a card `description` and a tour step body: the box has a size, and text past it is painted on
  top of the next node, not hidden.
- *"This lane label plus its subtitle is 60 characters, but it reads so well."* → it wraps to
  three lines and lands on the first card. Drop the subtitle; it is on the cards already.
- *"I'll shrink the card to fit the layout and let the text wrap."* → backwards. The card sizes
  are fixed by §5 so that every lane lines up; the **text** is what gets cut to fit them.
