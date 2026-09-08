# `review-model.json` — contract + authoring doctrine

The PR analyzer writes exactly one file, `$SEEFLOW_TMP/review-model.json`, conforming to the contract below. One pass over the diff produces the whole model — elements, relations, views, sequence, walkthrough — and nothing downstream re-reads the diff. Flow writers read this file and turn it into flows; they own ids, geometry, lane bands and colour. The model carries meaning only: no positions, no sizes, no node types, no colour tokens.

## The shape

`//` lines below are annotations. The file itself is plain JSON with no comments.

```json
{
  "title": "Receipt mail moves off the request path",
  "summary": "POST /checkout used to call the mail provider inline, so a slow provider slowed checkout. The route now writes one job to the receipts queue and returns. A worker drains the queue every 10s and sends up to 500 receipts per provider call. The old inline sender is deleted; the provider and the orders table are untouched. 6 of the 11 files are test snapshots and import churn.",
  "chips": [
    { "label": "Provider calls", "value": "500x fewer", "tone": "hero" },
    { "label": "Provider round-trips", "value": "off the request path", "tone": "modified" },
    { "label": "Inline sender", "value": "deleted", "tone": "removed" }
  ],
  "pr": {
    "url": "https://github.com/acme/storefront/pull/2841",
    "number": 2841, "repo": "acme/storefront",
    "title": "Batch receipt mail through a queue",
    "author": "dana-l",
    "headSha": "9c1f0ab", "baseSha": "4471de2",   // mergeBaseOid, never baseRefOid
    "state": "open",
    "filesChanged": 11, "additions": 402, "deletions": 168
  },
  "lanes": [
    { "id": "request",  "label": "Request path", "subtitle": "runs inside checkout", "order": 0 },
    { "id": "async",    "label": "Background",   "subtitle": "queue + worker",       "order": 1 },
    { "id": "external", "label": "Outside",                                          "order": 2 }
  ],
  "elements": [
    { "id": "checkout-route", "label": "POST /checkout", "kind": "route", "delta": "modified",
      "lane": "request", "subtitle": "src/http/checkout.ts",
      "detail": "Takes the cart, writes the order, and answers the browser.\n\nIt used to call the mail sender before answering. It now writes one row to the receipts queue and returns straight away.",
      "files": [ { "path": "src/http/checkout.ts", "lines": "88-141", "why": "inline send replaced by an enqueue" } ] },
    { "id": "orders-db", "label": "orders table", "kind": "datastore", "delta": "unchanged",
      "lane": "request", "detail": "Order rows. The change does not touch the writes here, but the enqueue happens in the same transaction.",
      "files": [] },
    { "id": "inline-sender", "label": "sendReceiptNow", "kind": "function", "delta": "removed",
      "lane": "request", "subtitle": "one provider call per order",
      "detail": "Sent one receipt per call, on the request path. Deleted — the worker does this work for whole batches now.",
      "files": [ { "path": "src/mail/send-receipt-now.ts", "gone": true, "why": "deleted" } ] },
    { "id": "receipt-queue", "label": "receipts queue", "kind": "queue", "delta": "added",
      "lane": "async", "subtitle": "Postgres-backed, at-least-once",
      "detail": "One row per receipt to send. Written in the checkout transaction, so a rolled-back order never queues mail.",
      "files": [ { "path": "src/queue/receipts.ts" } ] },
    { "id": "receipt-worker", "label": "receipt worker", "kind": "job", "delta": "added",
      "lane": "async", "subtitle": "every 10s, 500 per batch",
      "detail": "Claims up to 500 queued receipts, hands them to the mail client as one batch, and marks them sent. A failed batch is retried 5 times, then parked.",
      "files": [ { "path": "src/workers/receipt-worker.ts" } ] },
    { "id": "mail-client", "label": "mail client", "kind": "module", "delta": "modified",
      "lane": "async", "detail": "Gained `sendBatch`. The single-send helper stays for password resets.",
      "files": [ { "path": "src/mail/client.ts", "lines": "204-259", "why": "new sendBatch wrapper" } ] },
    { "id": "mail-provider", "label": "Mail provider", "kind": "external", "delta": "unchanged",
      "lane": "external", "detail": "Same account, same key. The change swaps which endpoint we call: `/email` becomes `/email/batch`.",
      "files": [] }
  ],
  "relations": [
    { "id": "route-writes-orders", "from": "checkout-route", "to": "orders-db",
      "kind": "data", "delta": "unchanged", "label": "insert order", "emphasis": "muted" },
    { "id": "route-enqueues", "from": "checkout-route", "to": "receipt-queue",
      "kind": "queue", "delta": "added", "label": "1 job per order", "emphasis": "hero",
      "detail": "The whole point of the change: the request path now ends here instead of at the provider." },
    { "id": "route-sent-inline", "from": "checkout-route", "to": "inline-sender",
      "kind": "call", "delta": "removed", "label": "was: send now", "emphasis": "normal" },
    { "id": "worker-drains", "from": "receipt-queue", "to": "receipt-worker",
      "kind": "queue", "delta": "added", "label": "claim 500", "emphasis": "normal" },
    { "id": "worker-calls-client", "from": "receipt-worker", "to": "mail-client",
      "kind": "call", "delta": "added", "label": "sendBatch", "emphasis": "normal" },
    { "id": "client-calls-provider", "from": "mail-client", "to": "mail-provider",
      "kind": "http", "delta": "modified", "label": "POST /email/batch", "emphasis": "normal" }
  ],
  "views": [
    { "id": "send-path", "title": "How a receipt gets sent",
      "purpose": "The path from checkout to the provider, with the retired inline call left in so the swap is visible.",
      "scope": { "elements": ["checkout-route", "receipt-queue", "receipt-worker", "mail-client", "mail-provider", "inline-sender"],
                 "relations": ["route-enqueues", "route-sent-inline", "worker-drains", "worker-calls-client", "client-calls-provider"] },
      "children": [
        { "id": "batch-drain", "title": "One drain cycle",
          "purpose": "What the worker does every 10s: claim, send, mark, retry.",
          "scope": { "elements": ["receipt-queue", "receipt-worker", "mail-client"],
                     "relations": [] },   // empty = every relation with both ends in scope
          "children": [] }
      ] }
  ],
  "sequence": {
    "title": "Checkout to receipt",
    "participants": ["checkout-route", "receipt-queue", "receipt-worker", "mail-client", "mail-provider"],
    "messages": [
      { "id": "m1", "from": "checkout-route", "to": "receipt-queue", "label": "enqueue receipt", "kind": "sync",   "delta": "added" },
      { "id": "m2", "from": "checkout-route", "to": "checkout-route", "label": "200 to the browser", "kind": "self", "delta": "modified",
        "note": "Returns without waiting for mail." },
      { "id": "m3", "from": "receipt-worker", "to": "receipt-queue", "label": "claim up to 500", "kind": "sync",  "delta": "added" },
      { "id": "m4", "from": "receipt-worker", "to": "mail-client",   "label": "sendBatch(500)",   "kind": "sync",  "delta": "added" },
      { "id": "m5", "from": "mail-client",    "to": "mail-provider", "label": "POST /email/batch","kind": "async", "delta": "modified" },
      { "id": "m6", "from": "mail-provider",  "to": "mail-client",   "label": "202 accepted",     "kind": "return","delta": "modified" }
    ]
  },
  "walkthrough": [
    { "id": "w1", "heading": "Checkout no longer sends the mail", "body": "The route returns as soon as the order row is written, instead of waiting for the provider.",
      "stage": "main", "focus": ["checkout-route", "route-enqueues"] },
    { "id": "w2", "heading": "Added a receipts queue", "body": "One row per order, written in the same transaction, so a rolled-back order never queues mail.",
      "stage": "main", "focus": ["receipt-queue"] },
    { "id": "w3", "heading": "New worker drains 500 at a time", "body": "Every 10s it claims 500 receipts and sends them in 1 provider call instead of 500.",
      "stage": "send-path", "focus": ["receipt-worker", "worker-drains"] },
    { "id": "w4", "heading": "sendReceiptNow is deleted", "body": "Nothing calls the provider from the request path any more; password-reset mail still uses the single-send helper.",
      "stage": "send-path", "focus": ["inline-sender", "route-sent-inline"] }
  ],
  "notes": ["The provider's batch endpoint is described from the client change; the provider is not in this repo."]
}
```

### Fields

Top level:

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `title` | string | ≤80 | What a reviewer would call this change. |
| `summary` | string | ≤600 | Answers "what does this change do?" in plain prose. Its last sentence accounts for the churn (see "What does not go on the picture"). |
| `chips[]` | array | ≤6 | Headline numbers: `{label, value ≤24, tone}`; `tone` ∈ `neutral\|added\|modified\|removed\|hero`. Every value is traceable; `[]` is a normal answer. |
| `pr` | object | — | See below. |
| `lanes[]` | array | 1–4 | See below. 0 only in the no-map degenerate case. |
| `elements[]` | array | ≤60 | See below. The cap is a ceiling, not a target. |
| `relations[]` | array | ≤90 | See below. |
| `views[]` | array | 0–3 roots | See below. |
| `sequence` | object \| null | — | `null` when the change has no order worth walking. |
| `walkthrough[]` | array | 0, or 2–10 | See below. A 1-step walkthrough is not a walkthrough. |
| `notes[]` | array | ≤5 | How the model was made, not what the code does: a truncated diff, a region you chose not to read, an area you did not model, "Dependency-only change; there is nothing to draw." Never a finding, never a verdict, never a summary of the change. Omit when empty. |

No other top-level key exists. An unknown key is a rejection of the whole model, not something the pipeline trims for you.

`pr`: `url`, `number` (int), `repo` (`owner/name`), `title`, `author` (a login string, not an object), `headSha`, `baseSha`, `state`, `filesChanged`, `additions`, `deletions` (ints). Copy them from the metadata file you were handed — you have no other source — and never restate them in prose where they can drift.

- `baseSha` — copy `mergeBaseOid` from the metadata. **Never `baseRefOid`**: that is the base branch's tip today, the diff you were given is against the merge base, and a blob link built from the tip shows a reviewer a file the pull request never forked from.
- `state` — lowercase the metadata's `state`, except when `isDraft` is true, where `state` is `"draft"`. Draft is reported separately; there is no `DRAFT` state to copy.

`lanes[]`: `id`, `label` ≤28, `subtitle?`, `order` (int, ascending left to right).

`elements[]` — one per thing on the picture:

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `id` | string | — | Stable within this file. |
| `label` | string | ≤40 | The card title, spelled the way the team says it out loud. Never a filename. |
| `kind` | enum | — | `service app route module function job queue datastore cache external ui actor config test other`. |
| `delta` | enum | — | `added modified removed unchanged`. |
| `lane` | string | — | A declared lane id. |
| `subtitle?` | string | ≤48 | A signature, a path, a rate — one line under the title. |
| `detail` | markdown | 1–3 short paragraphs | What this is, and what the change did to it. Becomes the panel a reviewer opens. |
| `files[]` | array | ≤6 | `{path, lines?, why?, gone?}`. `path` is repo-relative POSIX, no leading slash. `lines` is `"120-186"`, taken from the diff's `@@` header — the hunk the reviewer should land on; omit it when the change is spread through the file. `gone: true` marks a file that does not exist at head (deleted, or the old side of a rename), and is set **per file, not per element** — a `modified` element routinely deletes one of its files. `why` is at most 8 words. Six is the cap: past that you are listing the diff, and the seventh file belongs to a different element. |

`relations[]` — one per connection worth drawing:

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `id` | string | — | Stable within this file. |
| `from` / `to` | string | — | Declared element ids. |
| `kind` | enum | — | `call http event queue data dependency render other`. |
| `delta` | enum | — | Same four values as an element. |
| `label?` | string | ≤40 | What travels: a verb, an event name, a route. |
| `emphasis` | enum | — | `normal \| hero \| muted`. Hero is rationed; muted is context you want present but quiet. |
| `detail?` | markdown | short | Only when the connection needs more than its label. It renders on the panel of the element the relation points **at**, so write it as a sentence about that end. |

`views[]` — named narrowings, each of which becomes its own flow:

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `id` | kebab | ≤24 | Unique across every view at any depth. |
| `title` | string | ≤40 | What the reader is about to look at. |
| `purpose` | string | ≤140 | Why they would open it. |
| `scope` | object | — | `{elements[], relations[]}` — ids drawn in this view. `relations: []` means the induced picture: every relation with both ends in `scope.elements`. |
| `children[]` | array | 2 levels total | A root and its children; a child's `children` is empty. |

`sequence` — `title`, `participants[]` (2–5 element ids, array order is column order), `messages[]` (2–14):

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `id` | string | — | Unique within `messages`. |
| `from` / `to` | string | — | Must both be listed in `participants`. |
| `label` | string | ≤40 | What is sent. |
| `kind` | enum | — | `sync \| async \| return \| self`. |
| `delta` | enum | — | What the change did to this step. |
| `note?` | string | short | An aside the label cannot carry. |

Array order is step order. There is no step-number field, so the file cannot disagree with itself.

`walkthrough[]` — the guided read:

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `id` | string | — | Unique within the walkthrough. |
| `heading` | string | ≤48 | The thing plus what happened to it. |
| `body` | string | ≤140 | What is different in behaviour now. Required. |
| `stage` | string | — | A view id, `"main"`, or `"sequence"`. Required — never omitted, never null, never a guess. |
| `focus[]` | array | 1–3 | Element or relation ids this step is about. |

### Rules a flow writer trusts

- Every `from`/`to`, every `scope.elements` and `scope.relations` entry, every `participants` id, and every `focus` id resolves to something declared in this file (`focus` may name an element **or** a relation; the rest name elements).
- Every element's `lane` is a declared lane id.
- Ids match `/^[a-z0-9][a-z0-9-]*$/` and are unique within their own collection. Flow-writer node ids are derived from these, so a duplicate here is a duplicate on the canvas.
- A view's `relations` may be empty; that means every relation whose `from` and `to` are both in `scope.elements`.
- A `self` message has `from === to`; no other kind does.
- A `sequence` has at least 2 participants, or it is `null`.
- `stage: "sequence"` is legal only when `sequence` is non-null. `stage` naming a view means that view id exists.

## What makes the model worth reading

- **Draw the unchanged neighbours the change reaches, marked `unchanged`.** A picture of only the touched lines cannot show blast radius. This is not padding — include a neighbour because the change reaches it, and leave out the ones it does not.
- **Every element earns a line to something.** An element with no relation is a card floating in a band, and a reviewer cannot tell whether it is genuinely isolated or whether you stopped tracing. Either draw the relation that puts it in the picture — a `dependency` or `data` relation marked `unchanged` is a real answer — or fold it into the `detail` of the element it belongs to. The one exception is an `actor` that starts a flow.
- **Lanes are the reader's mental model, never the folder tree.** A runtime, a tier, a boundary they already hold in their head. One to four. A fifth lane almost always means two of them are the same boundary at different zoom — merge those two.
- **An element is a thing the team names out loud, not a file.** One element may cover a dozen files and one file may split into two elements; the mapping is never 1:1. Before you draw a card, ask whether someone would say this name in a standup — `checkout route`, `receipt worker`, `orders table` yes; `checkout.ts`, `utils`, `index` no. Files belong in `files[]`, never in a `label`. The right element count is roughly the number of boundaries the change crosses: 8 to 20 for a change of any size, and a 40-file pull request does not get 40 cards any more than a 200-file one gets 60. If two cards would always be read together, they are one card with two files.
- **Ration `hero`: two relations per model, maximum.** Hero marks the connection the change is actually about. A third hero means none of the three reads as one.
- **A chip's number comes from the diff, the file list, or the pull request's own prose — never from you.** "Provider calls · 500x fewer" is legitimate when the diff shows a batch of 500 replacing a per-item call. "Route p95 · 820ms to 40ms" is not, unless a human wrote those numbers in the pull request body, because no diff contains a latency. If you cannot point at where a number came from, the chip does not exist. `chips: []` is a normal answer, and it is a better one than a number you made up. The same rule governs every digit in a `summary`, a `detail` or a walkthrough `body`.
- **This model describes the change, and only the change.** No bug reports, no risk scores, no severity, no verdicts, no approvals, no "consider extracting this helper". There is no field for them; an unknown key fails validation and the whole model is rejected rather than trimmed. **And the ban is on the judgement, not on the field name.** A verdict smuggled into a `detail` paragraph, a `summary` clause, a chip or a walkthrough `body` is the same violation as a `risks` array, and it is the one you will actually be tempted to commit. The test is the tense: a sentence about what the code *is* or *does* belongs here; a sentence about what it *should* be, *might* break, or *fails to* handle does not.

  | Write this | Not this |
  |---|---|
  | Retries 5 times, then parks the job in `dead_letters`. | Retry handling looks solid, though the backoff could be tuned. |
  | The worker claims rows with `FOR UPDATE SKIP LOCKED`, so two workers never claim the same row. | Nothing tests two concurrent workers — worth adding. |
  | The route no longer waits for the provider. | This is a risky change to the checkout path; review carefully. |

  A reviewer reads this to know where to look, then reads the code. Pointing at the place is your whole job; the opinion about it is theirs.

- **Summaries and detail answer "what is this, and what did the change do to it"** in words a new joiner follows on the first read. Name things the way the diff names them. Numbers as digits.
- **Add a `sequence` only when the change has an order worth walking.** One honest sequence beats three thin ones; `null` is a normal answer.
- **A view's `scope` may name elements alone.** Leave `relations` empty and every relation whose two endpoints are both in scope is drawn — the induced picture. Name relations only to draw *fewer* than that, and then you own the whole list. Naming an element pulls its lane in with it; lanes are never declared in a scope.
- **A view narrows and can never widen.** `scope.elements` carries at least two ids and never every element in the model — a view of everything is `main`, and shipping it twice teaches the reader that links go nowhere. A view whose scope resolves to fewer than two elements, or to the same set as its parent, is deleted rather than padded back out.
- **Depth is zoom, not taxonomy.** A root view is one path through the system; its child is a single step of that path opened up. Never a third level, never a child that is its parent minus one card. Zero views is right for a small change — skip a view rather than invent one.
- **`files` entries are what a reviewer clicks.** Attach them wherever the diff shows where something lives. Repo-relative POSIX paths, no leading slash; `lines` when the diff points at one hunk; `gone: true` on any path that does not exist at head.

## What does not go on the picture

A large pull request is mostly not the change. Before you draw anything, split the file list in two: the files that carry the change, and the churn that came with it.

Never becomes an element: lock files and vendored dependency trees, generated or compiled output, snapshot and fixture updates, import-only or formatting-only hunks, mass renames of a symbol, translation and asset bundles. Test files are churn unless the change *is* the tests (see "Degenerate cases").

Account for what you dropped in one sentence at the end of `summary`, with digits: "31 of the 42 files are lockfile, snapshot and import churn." Never list them, never draw them, never leave them unmentioned — a reviewer who counts 42 files in the pull request and 9 cards on the picture has to be told that 31 of those files were nothing, or they will assume you missed them.

Saying which files actually carry the change is the most useful thing this model does. Do it explicitly, not by omission.

## Degenerate cases

Much of this document assumes a change with shape. Many pull requests have none. Recognise these from the file list before you read a hunk, and take the short path — a ceremonial diagram of a typo is worse than no diagram, because someone has to open it to find that out.

| The pull request | What to emit |
|---|---|
| **Under ~5 files, one boundary** — a typo, a copy fix, a single-file bump | One lane, the touched elements plus their immediate neighbours, no views, `sequence: null`, no walkthrough. `main` is the whole artifact. |
| **Dependency or lock file only** — `bun.lock`, `package-lock.json`, vendored trees, a `package.json` bump with no code | No map. `lanes: []`, `elements: []`, `relations: []`, `sequence: null`, `walkthrough: []`, a `summary` naming what moved from which version to which, and one `notes` entry: `"Dependency-only change; there is nothing to draw."` The orchestrator prints the summary and creates no project. Do not invent a "dependencies" lane to have something to show. |
| **Pure rename or move**, no behaviour change | One element per moved unit, `delta: "unchanged"`, `subtitle` = `"moved: old/path → new/path"`, relations `unchanged`. Nothing is `added` and nothing is `removed`: a rename is one thing in two places, not two things. `files[]` carries the new path, plus the old path with `gone: true`. No views, no sequence. |
| **Tests only** | The units under test are elements marked `unchanged`; the suites are elements marked `added` or `modified`, `kind: "test"`, in one lane of their own. The blast-radius rule does not license inventing production elements the diff does not show. No sequence, no views. |
| **Generated output only** — schema dumps, snapshots, translations, build artifacts | Model the generator and its input, plus the output as one element. Never one element per generated file. |
| **200 files or more** | The caps scale you down, not up. Pick the ≤5 boundaries the change is about and model those; the rest is churn accounted for in one `summary` sentence with digits. 200 files still means 10 to 20 cards. Say in `notes` which areas you did not model. |
| **Two unrelated changes in one pull request** | Model both, and say so in the first sentence of `summary`. Do not drop the smaller one, and do not invent a relation between them to make one picture. |

In every degenerate case the walkthrough is the first thing to cut and the `summary` is the last. A reviewer who gets one honest paragraph and no diagram has been served. One who gets a three-lane diagram of a lockfile has been wasted.

## Writing the walkthrough

The walkthrough is the fastest possible read of the change — often the only part a busy reviewer finishes.

- **2–10 steps, aim for 3–6.** Each step is one thing that happened, in the order a reviewer needs it. A step is never a description of the picture.
- **Step one is the headline change.** If there is a whole-picture step, it goes last.
- **`heading`** — the thing plus what happened to it, ≤48 chars, sentence case, built from change verbs: added, removed, replaced, moved, split, now. If the heading could have been true before this change, it is not a heading.
- **`body`** — one line, ≤140 chars, on what is different in behaviour now: what happens that did not, or what stopped, with the numbers when there are numbers — and only numbers you can point at in the diff. Not a restatement of the heading. Required on every step.
- **`stage`** — which flow the reader should be looking at. Keep consecutive steps on one stage; every change of stage throws the reader across the canvas.
- **`focus`** — one to three ids the step is actually about. A step that points at half the diagram has pointed at nothing.
- **A step that loses its focus loses itself.** If every id in a step's `focus` is gone — cut from the model, trimmed by the flow cap — the step is deleted, not widened to point at the whole picture. If that leaves fewer than 2 steps, there is no walkthrough at all and no `tour` flow. A widened step is the one kind of step that says nothing, and it is exactly what you will write to avoid deleting your own work.
- **`stage` must name a flow that will exist.** A step staged on a view the flow cap dropped is re-staged on `main` when its focus still resolves there, and deleted otherwise. Never stage a step on a flow you hope exists.
- **Voice** — short common words, one idea per line, active voice, digits for numbers. If a line needs a second read, rewrite it.

| Write this | Not this |
|---|---|
| **Cache is now keyed per tenant** · One tenant's edit stops leaking into another tenant's list. | **Cache key strategy refactored** · The caching layer was updated to incorporate tenant scoping into key derivation. |
| **Webhooks retry 5 times** · A failed delivery is retried for 30 minutes, then parked in the dead-letter table. | **Improved webhook reliability** · Delivery robustness is enhanced through an exponential backoff retry mechanism. |
| **orders.status column is gone** · Status now reads from order_events; the backfill runs before the column drop. | **Schema migration applied** · The migration removes a denormalised column in favour of an event-sourced projection. |
| **Worker drains 500 at a time** · One provider call now covers 500 receipts instead of 500 calls. | **New worker in the background lane** · A job card sits between the queue and the mail client, joined by two new lines. |
| **Receipts moved off the request path** · Checkout answers without waiting for mail; the send happens within 10s. | **Refactored the receipt pipeline** · Touches 12 files across `src/http`, `src/queue` and `src/workers`. |
| **sendReceiptNow is deleted** · Nothing calls the provider from a request any more. | **Mail sending is now batched** · The system uses a queue-based architecture for receipts. |

The first three right-hand cells are jargon. The last three are the failures you will actually commit, in the order you will commit them: describing the picture, narrating the file list, and restating the whole pull request instead of one step of it.

## Red flags — stop and reconsider

If you catch yourself thinking any of the following, you are rationalising.

- "This change has an obvious footgun — I'll add a `findings` array / a `risk` on the element." → there is no such field, and a model that carries one is rejected, not trimmed. Put where-to-look in `detail`; leave the verdict to the reviewer.
- "There is no field for it, so I'll just put the warning in the `detail` sentence." → that is the same violation with better manners. Judgement is banned wherever it lands.
- "Only the changed things matter — unchanged elements are noise." → then the picture has no blast radius. The neighbours the change reaches are the context that makes it legible.
- "There are 40 files, so there are 40 elements." → then you have shipped a directory listing with colours. Cards are boundaries the change crosses, and most of those 40 files are churn you account for in one sentence.
- "There are five source folders, so there are five lanes." → lanes are boundaries a reader already holds, not directories. One to four, or merge.
- "Every one of these relations is important, so they are all `hero`." → emphasis is a scarcity signal. Two at most; past that the diagram emphasises nothing.
- "A chip needs a number, and this looks like it saves about 90% of the latency." → you measured nothing. A number you cannot point at in the diff makes the reviewer doubt the panel next to it.
- "It is only a lockfile bump, but I should still draw a two-lane picture." → no. Say what moved, in one paragraph, and draw nothing.
- "Step 3: the worker sits in the background lane next to the queue." → that describes the picture. A step says what happened and what is different now.
- "This step's focus was trimmed, so I'll point it at the whole flow instead." → delete the step. A step that points at everything points at nothing.
- "The child view repeats its parent minus one element — it still adds a level." → it does not. Same elements means one view; delete the child.
- "The diff was truncated, but the rest of that file probably does X." → do not write it. Describe what the diff actually shows, and say in `notes` where you stopped.
