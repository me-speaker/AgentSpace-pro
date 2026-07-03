// FSM L2 close-out — Minimal getDatabase() for the test repo.
//
// Why node:sqlite (not better-sqlite3, not pg):
//   - The L2 store.ts uses SQLite-style sync API (db.prepare().run/get/all,
//     db.exec). Translating to PG would require wrapping every call to
//     async, which is invasive.
//   - node:sqlite is built into Node 22.5+ (stable in v24) — no npm
//     install, no network risk, no better-sqlite3 native build.
//   - The "test PG 5433" reference in persistence.test.ts was a leftover
//     from the original PG-aspirational design; the actual store.ts
//     API only requires a sync SQLite-style driver. This is a cleaner
//     foundation for the L4 AS-integration close-out.
//
// The returned object exposes the same surface the L2 store.ts uses:
//   - db.exec(sql)              → run raw SQL
//   - db.prepare(sql).run(...)  → INSERT/UPDATE/DELETE
//   - db.prepare(sql).get(...)  → SELECT one row
//   - db.prepare(sql).all(...)  → SELECT many rows
//
// Schema is applied lazily on first getDatabase() call (idempotent
// CREATE TABLE IF NOT EXISTS).

import { DatabaseSync } from "node:sqlite";
import { WORKFLOW_SCHEMA_SQL, WORKFLOW_SCHEMA_VERSION } from "./schema.ts";

const DEFAULT_DB_PATH = process.env.WORKFLOW_TEST_DB_PATH ?? ":memory:";

let _db: DatabaseSync | null = null;
let _appliedSchemaVersion = 0;

function applySchema(db: DatabaseSync): void {
  for (const stmt of WORKFLOW_SCHEMA_SQL) {
    db.exec(stmt);
  }
  _appliedSchemaVersion = WORKFLOW_SCHEMA_VERSION;
}

export function getDatabase(): DatabaseSync {
  if (_db === null) {
    _db = new DatabaseSync(DEFAULT_DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    applySchema(_db);
  }
  return _db;
}

export function resetDatabaseForTests(): void {
  if (_db !== null) {
    _db.close();
    _db = null;
    _appliedSchemaVersion = 0;
  }
}

export function getAppliedSchemaVersion(): number {
  return _appliedSchemaVersion;
}
