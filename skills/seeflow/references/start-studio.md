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

If `docker run` exits **non-zero**, surface stderr to the user, then attempt the proxy retry in **§3a.1** before falling back to §4. Common causes:

| stderr signal | Likely cause |
|---|---|
| `pull access denied` / `manifest unknown` / `failed to resolve` | Image pull failed (network, registry, auth) — proxy retry may help |
| `net/http: TLS handshake timeout` / `i/o timeout` / `dial tcp: lookup ... no such host` | Network egress blocked — proxy retry may help |
| `port is already allocated` / `bind: address already in use` | Port 4321 taken by another process — proxy will NOT help, skip to §4 |
| `name "seeflow" is already in use` | Stopped container with same name still exists — tell user: `docker rm -f seeflow`, skip §3a.1 |
| `Cannot connect to the Docker daemon` | Daemon stopped between §2 and §3 — skip §3a.1, go to §4 |

### 3a.1. Proxy retry (only for network-class failures)

Only run this step when the failure looks network-related (image pull, DNS, TLS, timeout). Skip it for port conflicts, daemon errors, or name collisions — a proxy can't fix those.

First check whether the host shell already exports proxy variables:

```bash
env | grep -iE '^(https?_proxy|no_proxy)=' || true
```

**If at least one of `HTTP_PROXY` / `HTTPS_PROXY` is set:** retry once, forwarding the host's proxy env into the container. Use `host.docker.internal` if the proxy URL points at `localhost` / `127.0.0.1` (the container can't reach the host loopback directly).

```bash
docker rm -f seeflow >/dev/null 2>&1 || true
docker run --rm -d --name seeflow -p 4321:4321 -v "$PWD":/workspace \
  ${HTTP_PROXY:+-e HTTP_PROXY="$HTTP_PROXY"} \
  ${HTTPS_PROXY:+-e HTTPS_PROXY="$HTTPS_PROXY"} \
  ${NO_PROXY:+-e NO_PROXY="$NO_PROXY"} \
  ${http_proxy:+-e http_proxy="$http_proxy"} \
  ${https_proxy:+-e https_proxy="$https_proxy"} \
  ${no_proxy:+-e no_proxy="$no_proxy"} \
  tuongaz/seeflow
```

**If no proxy env vars are set:** ask the user once with `AskUserQuestion`:

> Docker run failed with a network error. Are you behind an HTTP proxy I should retry with?
>
> - **No proxy** — skip the retry, fall through to §4.
> - **Yes — enter URL** — accept a `host:port` or full URL (e.g. `http://proxy.corp:8080`), then run the retry above with that value set for both `HTTP_PROXY` and `HTTPS_PROXY`.

On retry **success** → go to §3b. On retry **failure** → surface the new stderr verbatim and continue to §4. Do **not** loop — one proxy retry maximum.

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
