# Live Share leak rehearsal — runbook

Operator playbook for the scenario where a Live Share URL (or the peer JWT inside it) is exposed publicly — pasted into the wrong Slack, screenshared on a recording, indexed by a crawler, etc. The Phase 9 hardening (rate limits, peer-cap, replay protection, abuse alarms) is designed to bound the blast radius. This doc explains what to watch for, how to contain it, and how to rehearse so the muscle memory exists before it matters.

Pair with [2026-05-31-live-share-design.md](./2026-05-31-live-share-design.md) — "Hardening (Phase 9)" section — for the enforced caps and alarm names that this runbook references.

## Scenario

A Live Share session is active. The session URL (which embeds a 5-minute peer JWT or a fragment that mints one via `POST /share/join`) leaks. Possible flavours:

- **Public paste.** Host copy-pasted the URL into the wrong channel; it is indexable.
- **Screenshare leak.** URL was visible in a recorded demo or live stream.
- **Insider misuse.** A legitimate peer forwards the URL to someone outside the intended audience.
- **Crawler / bot pickup.** A scraper hits `/share/join` with a brute-forced fragment.

Assumed posture (Phase 9):

- DDB TTL auto-cleans idle sessions within 30 min.
- Peer JWTs expire 5 min after mint; the URL fragment must hit `/share/join` to mint a new one (so a stale screenshot beyond 5 min is a low-grade risk).
- Per-session caps: 20 peers, 256 KB max frame, 30 frames/sec/conn, 10 MB/min/session, 10 MB max upload, 1 GB session upload total. See `cloud/lambda/share/shared/limits.ts`.

## Detection signals

The earliest signs an incident is unfolding:

| Signal | Where | What it tells you |
|---|---|---|
| **CloudWatch alarm `AuthFailureBurst`** | `Seeflow/Share/share.auth_failure ≥ 20 in 5 min` | Bots / replays hammering `auth-peer`. See US-092. |
| **CloudWatch alarm `RateLimitedBurst`** | `Seeflow/Share/share.rate_limited ≥ 50 in 5 min` | A connection (or several) is being throttled — typically only legitimate when the host is mid-deploy. |
| **CloudWatch alarm `PeerCapHit`** | `Seeflow/Share/share.peer_cap_reached ≥ 5 in 5 min` | The session is bumping the 20-peer cap; someone is fan-out joining beyond the host's expectation. |
| **Audit log** | `~/.seeflow/share-history/<sessionId>.jsonl` | Per-op record of every peer join, edit, kick, rotate, and kill on the host. Grep `"type":"peer-join"` to see who joined when. |
| **In-UI peer list** | LiveShareDialog → connected peers panel | Host sees every current peer's display name and connId. Unexpected peers are visible without leaving the studio. |
| **Audit drawer (host studio)** | LiveShareDialog → audit drawer | Tail-following view of the JSONL log; flags kick / rotate / kill entries in red. |

A combination of any two of those signals — e.g. `AuthFailureBurst` firing while the in-UI peer list shows unexpected display names — is treated as a confirmed incident and should trigger the host-side containment steps.

## Containment steps (host)

The host has three first-class affordances inside `LiveShareDialog`, all of which write to the audit log:

1. **Kick all unknown peers.** From the connected-peers list in `LiveShareDialog`, click "Kick" next to each peer you do not recognise. This calls `POST /api/share/kick` (host local API) which forwards to `ShareController.kickPeer` → relay `PostToConnection` with a `kick` envelope. The kicked peer's `share-client` receives the frame and tears down. The audit drawer records each kick.
2. **Rotate the URL.** From `LiveShareDialog`, click "Rotate URL". This calls `POST /api/share/rotate` which (a) increments `tokenVersion` on the DDB session row, (b) mints a new URL fragment, (c) invalidates every in-flight peer JWT (next frame from a stale JWT returns 401 `token-version`). The new URL is copied to the clipboard. Distribute it through a trusted channel.
3. **End the session.** From `LiveShareDialog`, click the kill-switch ("End session for everyone"). Confirms via dialog, then calls `POST /api/share/stop`, which (a) deletes the DDB session row, (b) writes a `kill-switch` audit entry, (c) tears down every peer and the host WebSocket. DDB TTL would also clean up within 30 min even without this; the kill-switch is immediate.

Notes:

- Rotate-then-kick is the recommended order if you can't verify peers fast: rotate first to stop new joins on the leaked URL, then triage the connected-peers list.
- The kill-switch is the right answer when triage is impractical (e.g. >5 unknown peers, alarms firing in burst). It is fast, irreversible from the relay side, and starts a clean session with a new URL when you restart.
- Every action above appends an entry to `~/.seeflow/share-history/<sessionId>.jsonl` (per US-084). Keep that file; it is the post-incident record.

## Containment steps (operator)

When the host is offline / unresponsive, or the incident spans multiple sessions:

1. **Revoke a specific session by deleting the DDB row.**

    ```bash
    aws dynamodb delete-item \
      --table-name seeflow-share-sessions \
      --key '{"sessionId":{"S":"<id>"}}'
    ```

    Next time any peer (or the host) sends a frame, the relay's `getBySessionId` returns null and the connection is closed. Audit-log it in the incident ticket.

2. **Bump `SHARE_JWT_SECRET` to invalidate every in-flight peer JWT.** This is the nuclear option — it rolls every active session's peer JWT in a single deploy. Because the 5-min JWT ceiling already bounds in-flight tokens, this is rarely needed; reserve it for the case where the same leaked URL is being passed around faster than the host can rotate.

    - The secret is a CFN parameter on `SeeflowStack`. Edit the parameter via the CFN console or `aws cloudformation update-stack --parameters ParameterKey=ShareJwtSecret,ParameterValue=$(openssl rand -base64 32)`. The Lambda redeploys with the new env var.
    - All `auth-peer` calls with old JWTs return 401 `bad-signature`. Hosts get `tokenVersion` mismatch on their next frame too — they must re-mint via `POST /share/sessions`.

3. **Inspect CloudWatch for source patterns.** The structured log line `{"metric":"share.auth_failure","reason":"…","sessionId":…}` is what the alarms key off. Use Logs Insights to bucket by `reason` and time:

    ```
    fields @timestamp, @message
    | filter @message like /share\.auth_failure/
    | parse @message /"reason":"(?<reason>[^"]+)"/
    | stats count(*) by reason, bin(1m)
    ```

    Look for `bad-signature` bursts (brute force), `replay-detected` (the same JWT being reused — implies a successful leak), and concentrated source-IP ranges in the API Gateway access logs cross-referenced by `requestId`.

## Post-incident

After containment:

- Pull the session's JSONL audit log (`~/.seeflow/share-history/<sessionId>.jsonl`) into the incident ticket. Annotate every peer-join with whether the display name was expected.
- Snapshot the CloudWatch alarms' history (5-min window before and after detection) into the ticket.
- If `share.rate_limited` or `share.peer_cap_reached` fired, note the connId and any audit-log entries that correlate to host-driven kicks; this validates that the relay caps did their job.
- File a brief in the leak-rehearsal doc's "Past incidents" tail (see Rehearsal procedure below) with: timestamp, signal that fired first, time-to-contain, and one process change.
- Decide whether to roll the JWT secret. Default: no, unless the same URL was screenshotted publicly (i.e. unbounded leak) and 5-min token rotation isn't enough.

## Rehearsal procedure

Run quarterly. Goal: confirm the detection signals fire, the host UI affordances behave, and the team remembers the containment sequence.

1. **Setup.** A volunteer host starts a session in their studio and posts the URL into a designated private channel (`#share-rehearsal`). Three peer volunteers join from the channel.
2. **Trigger detection (replay).** A fourth volunteer copies one peer's URL, opens it twice in different browser profiles. Confirm: second join is rejected with `replay-detected`; CloudWatch `AuthFailureBurst` does not yet fire (it needs 20 in 5 min); the audit log records the failed join attempt only if the host received the frame (it should not for a 401 `replay-detected`).
3. **Trigger detection (peer cap).** Script a tiny CLI loop that mints 20 valid peer JWTs against the same session via `POST /share/join` and connects. Confirm: the 21st returns `429 peer-cap-reached`; the relay sends a courtesy `kick` envelope to the offender; `PeerCapHit` alarm transitions to ALARM after the 5-call threshold within 5 min.
4. **Trigger detection (rate limit).** Run a frame-flood script against one connId (e.g. 100 cursor frames in 1 sec). Confirm: at least one 429 `rate-limited:rate` response; the connId receives a `kick` envelope; the `share.rate_limited` metric ticks up.
5. **Host containment.** The host kicks two peers from the UI, rotates the URL, re-distributes the new URL. Confirm: kicked peer SPAs tear down; old URL no longer mints peer JWTs (`token-version` 401); audit drawer shows kick + rotate entries.
6. **Operator containment.** A second volunteer (acting as operator) deletes the DDB row for the rehearsal session. Confirm: every remaining peer disconnects with no usable state; host UI shows "Session ended".
7. **Findings.** Append a dated subsection at the bottom of *this* doc with: who participated, which alarms fired (and how long they took), what surprised you, and one process or doc change to make before the next rehearsal.

Tip: run rehearsals against a staging stack with its own `SHARE_JWT_SECRET` so a real prod leak rehearsal doesn't cross-contaminate prod metrics.

### Past rehearsals

_(Append a dated subsection here after each quarterly run.)_
