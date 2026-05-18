# Phase 0 — start the studio

Procedure for making the studio at `$STUDIO_URL` reachable before Phase 1. Called from SKILL.md Phase 0.

## 1. Probe

```bash
curl --max-time 0.5 -fsS "$STUDIO_URL/health"
```

- **200** → studio is up. Return to SKILL.md and continue to Phase 1.
- **Anything else** → continue below.

## 2. Pick a start path

```bash
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
```

- Exit 0 → Docker is available → **§3 (Docker path)**.
- Non-zero → Docker missing or daemon down → skip to **§4 (CLI path)**.

## 3. Docker path

Use `AskUserQuestion` to get explicit approval, showing the **exact** command verbatim:

> Studio not reachable at `$STUDIO_URL`. May I start it with Docker?
>
> ```
> docker run --rm -d --name seeflow -p 4321:4321 -v "$PWD":/workspace tuongaz/seeflow
> ```

Options:
- **Yes, run Docker** (recommended)
- **No, I'll use the CLI** → go to §4

### 3a. On "Yes" — run it

```bash
docker run --rm -d --name seeflow -p 4321:4321 -v "$PWD":/workspace tuongaz/seeflow
```

If `docker run` exits **non-zero**, surface stderr to the user and continue to §4. Common causes:

| stderr signal | Likely cause |
|---|---|
| `pull access denied` / `manifest unknown` / `failed to resolve` | Image pull failed (network, registry, auth) |
| `port is already allocated` / `bind: address already in use` | Port 4321 taken by another process |
| `name "seeflow" is already in use` | Stopped container with same name still exists — tell user: `docker rm -f seeflow` |
| `Cannot connect to the Docker daemon` | Daemon stopped between §2 and §3 |

### 3b. On success — poll `/health`

The first pull can take 30–60s. Poll up to **90s**:

```bash
deadline=$(( $(date +%s) + 90 ))
until curl --max-time 1 -fsS "$STUDIO_URL/health" >/dev/null 2>&1; do
  [ $(date +%s) -ge $deadline ] && break
  sleep 2
done
curl --max-time 1 -fsS "$STUDIO_URL/health" >/dev/null
```

- Reaches 200 within 90s → studio is up. Return to SKILL.md and continue to Phase 1.
- Times out → run `docker logs --tail 40 seeflow`, surface the tail to the user, continue to §4.

## 4. CLI path

Check `which seeflow`:

- **CLI found:** Tell the user: `Studio not reachable at <url>. Start it with: npx tuongaz/seeflow start`
- **CLI not found:** Tell the user: `Studio not reachable at <url> and the seeflow CLI is not installed. Run: npx tuongaz/seeflow start` or clone + `make dev`.

After surfacing the instruction, **stop**. Do not retry, do not auto-start, do not poll. The user starts the studio in another terminal and re-invokes `/seeflow`.

## Notes

- The container runs **detached** with `--name seeflow`. To stop it later: `docker stop seeflow`. The orchestrator never stops a container it started — that's the user's process now.
- `--rm` cleans up after `docker stop`; a clean stop leaves no leftover container.
- Do not invent flags. If the user's setup needs a different image tag, port, or mount, ask before changing the command.
