// FSM L2 close-out — Workflow schema (3 tables for agent_workflow_*)
//
// Used by `database.ts` (getDatabase) to apply the schema on first connect.
// The L2 commit (45305fc) shipped store.ts + persistence.test.ts but
// deferred schema migration + DB round-trip verification; this file
// is the missing piece.
//
// Notes:
//   - TEXT (not JSON) for jsonb-style columns. The store.ts layer
//     already does JSON.stringify/parse, so we keep this sync-friendly
//     for the node:sqlite driver used in the test repo.
//   - workspace_id is TEXT (not FK) because the test repo does not have
//     a workspace table. The prod schema (postgres-schema.ts) has the
//     real FK; the test schema keeps things isolated per MEMORY #24.
//   - Indexes: workspace_id (read-heavy), definition_id (instance→def),
//     callback_token (waiting-state resume), instance_id (history scan).

export const WORKFLOW_SCHEMA_SQL: string[] = [
  // ── agent_workflow_definition ──
  `
    CREATE TABLE IF NOT EXISTS agent_workflow_definition (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_workflow_def_workspace ON agent_workflow_definition(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_def_workspace_name ON agent_workflow_definition(workspace_id, name)`,

  // ── agent_workflow_instance ──
  `
    CREATE TABLE IF NOT EXISTS agent_workflow_instance (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      definition_id TEXT NOT NULL REFERENCES agent_workflow_definition(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      current_state TEXT NOT NULL,
      context_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      deadline_at TEXT,
      callback_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_workflow_inst_workspace ON agent_workflow_instance(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_inst_definition ON agent_workflow_instance(definition_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_inst_workspace_status ON agent_workflow_instance(workspace_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_inst_callback ON agent_workflow_instance(workspace_id, callback_token)`,

  // ── agent_workflow_history ──
  `
    CREATE TABLE IF NOT EXISTS agent_workflow_history (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES agent_workflow_instance(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_workflow_hist_instance ON agent_workflow_history(instance_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_hist_workspace ON agent_workflow_history(workspace_id, created_at)`,
];

export const WORKFLOW_SCHEMA_VERSION = 1;
