# CLI reference

The CLI is the only way the skill mutates a flow. Do not memorise commands,
flags, or body shapes — the CLI documents itself.

Resolve `$SEEFLOW` once at session start:

```bash
SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"
```

Then ask the CLI:

- `$SEEFLOW help` — list every subcommand by category.
- `$SEEFLOW help <command>` — synopsis, args, flags, body schema, output shape, error kinds, examples.

Treat the help output as the source of truth and follow the instructions it
prints. If a flag, body shape, or error kind is not in `help`, it does not
exist.

## Flow id vs slug

`help` documents most `<flowId>` arguments as "Flow id or slug" — but the
server currently only resolves by id (`flowNotFound` if a slug is passed).
**Use the `id` returned by `projects:create` for every follow-up call.**
Treat the slug as a URL convenience (the canvas opens at `$STUDIO_URL/d/<slug>`),
not as an addressable identifier from the CLI.

The studio URL resolves from `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json`
port → `http://localhost:4321`.
