---
techId: sqlite
category: storage
---

# SQLite

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per database **file** (`kind: "db"`, `icon: "database"`).
  Table-level is too fine-grained; a single SQLite file is one
  dependency regardless of how many tables it holds.
- Two-table flows are typical for embedded use cases (auth services:
  `users` + `sessions`; todo apps: `users` + `items`). Still one node;
  describe the tables in `data.detail` rather than splitting.
- No separate process to start. The "service" is the file on disk and
  the in-process driver — there is no port, no compose entry, no health
  endpoint to probe externally.

## Play (trigger locally)

- Reuse the project's existing DAO / repository / migration helper over
  a raw client. Grep for `better-sqlite3`, `bun:sqlite`, `sqlite3`,
  `database/sql + mattn/go-sqlite3`, or `sqlalchemy` + `sqlite:///`
  imports first.
- Honour the project's DB-path env (`DATABASE_URL`, `DB_PATH`,
  `SQLITE_PATH`) — never hard-code an absolute path.
- A play that *inserts* a row is usually more demo-useful than one that
  just opens the connection; let the audience see state land.

```ts
// Bun example (uses bun:sqlite — no extra dependency).
import { Database } from 'bun:sqlite';

const dbPath = process.env.DB_PATH ?? './data/app.sqlite';
const db = new Database(dbPath);
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
)`).run();
const email = `demo-${Date.now()}@example.com`;
const { lastInsertRowid } = db.prepare(
  'INSERT INTO users (email, created_at) VALUES (?, ?)'
).run(email, Date.now());
console.log(JSON.stringify({ inserted: { id: Number(lastInsertRowid), email } }));
db.close();
```

## Status (read locally)

- Open the file read-only (`mode=ro`, or driver-specific flag) so a
  poller never blocks writers.
- One small query per tick — row count, max id, latest row — not
  unbounded `SELECT *`.
- Tolerate "file does not exist yet" as `state: "warn"` (the play hasn't
  run); don't crash.

```ts
// Bun example — polls the users table and emits StatusReport per tick.
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

const dbPath = process.env.DB_PATH ?? './data/app.sqlite';

function report(state: string, summary: string, data: unknown) {
  process.stdout.write(JSON.stringify({ state, summary, data, ts: Date.now() }) + '\n');
}

while (true) {
  if (!existsSync(dbPath)) {
    report('warn', 'sqlite file not created yet', { path: dbPath });
  } else {
    try {
      const db = new Database(dbPath, { readonly: true });
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      report('ok', `${n} users`, { users: n });
      db.close();
    } catch (err) {
      report('warn', (err as Error).message, {});
    }
  }
  await new Promise((r) => setTimeout(r, 2000));
}
```

## Gotchas

- **WAL mode** (`PRAGMA journal_mode=WAL`) creates `*.sqlite-wal` and
  `*.sqlite-shm` sidecar files. The status probe must point at the
  same path; never `rm` only the main file when resetting state.
- **`:memory:` databases are per-connection.** Two scripts pointing at
  `:memory:` see different state. Use a file path for demos.
- **File locking under concurrent writes.** SQLite serialises writes; a
  Play that fires faster than the previous write committed can return
  `SQLITE_BUSY`. Use a short retry or set `PRAGMA busy_timeout=2000`.
- **No password / no port.** If a project's "database config" looks
  empty, that's normal — the path IS the config.
- **Migrations on first run.** Some projects run schema migrations on
  app start. If the Play script connects directly without the app
  running, `CREATE TABLE IF NOT EXISTS …` in the play (or running the
  project's migration step first) avoids "no such table".

## Fixture shape

```json
{ "id": 42, "email": "demo@example.com", "created_at": 1716355200000 }
```
