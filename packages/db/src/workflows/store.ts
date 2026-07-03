// FSM L2.4 — Workflow Store (DB-backed)
// persistence for agent_workflow_definition / instance / history.
//
// Mirrors the AgentSpaceSync *Sync naming convention so callers in services/
// can `import { ... } from "@agent-space/db"` without surprise.
//
// workspace_id is required on every write/read — no cross-workspace reads.

import { getDatabase } from "./database.ts";
import { randomUUID } from "node:crypto";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface WorkflowDefinitionRecord {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  definitionJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstanceRecord {
  id: string;
  workspaceId: string;
  definitionId: string;
  status: "active" | "completed" | "failed" | "waiting" | "cancelled";
  currentState: string;
  contextJson: Record<string, unknown>;
  attemptCount: number;
  deadlineAt: string | null;
  callbackToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowHistoryRecord {
  id: string;
  workspaceId: string;
  instanceId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: string;
}

// ── Inputs ──

export interface CreateWorkflowDefinitionInput {
  workspaceId: string;
  name: string;
  version?: number;
  definitionJson: Record<string, unknown>;
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  version?: number;
  definitionJson?: Record<string, unknown>;
}

export interface CreateWorkflowInstanceInput {
  workspaceId: string;
  definitionId: string;
  currentState: string;
  contextJson?: Record<string, unknown>;
  deadlineAt?: string | null;
  callbackToken?: string | null;
}

export interface UpdateWorkflowInstanceStateInput {
  status?: WorkflowInstanceRecord["status"];
  currentState?: string;
  contextJson?: Record<string, unknown>;
  attemptCount?: number;
  deadlineAt?: string | null;
  callbackToken?: string | null;
}

export interface RecordWorkflowHistoryInput {
  workspaceId: string;
  instanceId: string;
  eventType: string;
  fromState?: string | null;
  toState?: string | null;
  payloadJson?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Row → Record mapping (DB rows are snake_case; JS records are camelCase)
// ────────────────────────────────────────────────────────────────────────────

interface DefinitionRow {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  definition_json: string;
  created_at: string;
  updated_at: string;
}

function mapDefinitionRow(row: DefinitionRow): WorkflowDefinitionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    version: row.version,
    definitionJson: JSON.parse(row.definition_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface InstanceRow {
  id: string;
  workspace_id: string;
  definition_id: string;
  status: string;
  current_state: string;
  context_json: string;
  attempt_count: number;
  deadline_at: string | null;
  callback_token: string | null;
  created_at: string;
  updated_at: string;
}

function mapInstanceRow(row: InstanceRow): WorkflowInstanceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    definitionId: row.definition_id,
    status: row.status as WorkflowInstanceRecord["status"],
    currentState: row.current_state,
    contextJson: JSON.parse(row.context_json),
    attemptCount: row.attempt_count,
    deadlineAt: row.deadline_at,
    callbackToken: row.callback_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface HistoryRow {
  id: string;
  workspace_id: string;
  instance_id: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  payload_json: string;
  created_at: string;
}

function mapHistoryRow(row: HistoryRow): WorkflowHistoryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    instanceId: row.instance_id,
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    payloadJson: JSON.parse(row.payload_json),
    createdAt: row.created_at,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Definition CRUD
// ────────────────────────────────────────────────────────────────────────────

export function createWorkflowDefinitionSync(
  input: CreateWorkflowDefinitionInput,
): WorkflowDefinitionRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const version = input.version ?? 1;
  const id = `wfd_${randomUUID()}`;
  db.prepare(
    `INSERT INTO agent_workflow_definition (
      id, workspace_id, name, version, definition_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.name,
    version,
    JSON.stringify(input.definitionJson),
    now,
    now,
  );
  return readWorkflowDefinitionSync(id)!;
}

export function readWorkflowDefinitionSync(
  id: string,
): WorkflowDefinitionRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM agent_workflow_definition WHERE id = ?`)
    .get(id) as DefinitionRow | undefined;
  return row ? mapDefinitionRow(row) : null;
}

export function listWorkflowDefinitionsSync(
  workspaceId: string,
): WorkflowDefinitionRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM agent_workflow_definition WHERE workspace_id = ? ORDER BY updated_at DESC`,
    )
    .all(workspaceId) as DefinitionRow[];
  return rows.map(mapDefinitionRow);
}

export function updateWorkflowDefinitionSync(
  id: string,
  patch: UpdateWorkflowDefinitionInput,
): WorkflowDefinitionRecord | null {
  const db = getDatabase();
  const existing = readWorkflowDefinitionSync(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const name = patch.name ?? existing.name;
  const version = patch.version ?? existing.version;
  const definitionJson = patch.definitionJson ?? existing.definitionJson;
  db.prepare(
    `UPDATE agent_workflow_definition
     SET name = ?, version = ?, definition_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, version, JSON.stringify(definitionJson), now, id);
  return readWorkflowDefinitionSync(id);
}

export function deleteWorkflowDefinitionSync(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare(`DELETE FROM agent_workflow_definition WHERE id = ?`)
    .run(id);
  return result.changes > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Instance CRUD
// ────────────────────────────────────────────────────────────────────────────

export function createWorkflowInstanceSync(
  input: CreateWorkflowInstanceInput,
): WorkflowInstanceRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = `wfi_${randomUUID()}`;
  db.prepare(
    `INSERT INTO agent_workflow_instance (
      id, workspace_id, definition_id, status, current_state, context_json,
      attempt_count, deadline_at, callback_token, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.definitionId,
    "active",
    input.currentState,
    JSON.stringify(input.contextJson ?? {}),
    0,
    input.deadlineAt ?? null,
    input.callbackToken ?? null,
    now,
    now,
  );
  return readWorkflowInstanceSync(id)!;
}

export function readWorkflowInstanceSync(
  id: string,
): WorkflowInstanceRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT * FROM agent_workflow_instance WHERE id = ?`)
    .get(id) as InstanceRow | undefined;
  return row ? mapInstanceRow(row) : null;
}

export function listWorkflowInstancesForDefinitionSync(
  definitionId: string,
): WorkflowInstanceRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM agent_workflow_instance WHERE definition_id = ? ORDER BY created_at DESC`,
    )
    .all(definitionId) as InstanceRow[];
  return rows.map(mapInstanceRow);
}

export function listWorkflowInstancesForWorkspaceSync(
  workspaceId: string,
  status?: string,
): WorkflowInstanceRecord[] {
  const db = getDatabase();
  const rows = status
    ? (db
        .prepare(
          `SELECT * FROM agent_workflow_instance WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC`,
        )
        .all(workspaceId, status) as InstanceRow[])
    : (db
        .prepare(
          `SELECT * FROM agent_workflow_instance WHERE workspace_id = ? ORDER BY updated_at DESC`,
        )
        .all(workspaceId) as InstanceRow[]);
  return rows.map(mapInstanceRow);
}

export function updateWorkflowInstanceStateSync(
  id: string,
  patch: UpdateWorkflowInstanceStateInput,
): WorkflowInstanceRecord | null {
  const db = getDatabase();
  const existing = readWorkflowInstanceSync(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const status = patch.status ?? existing.status;
  const currentState = patch.currentState ?? existing.currentState;
  const contextJson = patch.contextJson ?? existing.contextJson;
  const attemptCount = patch.attemptCount ?? existing.attemptCount;
  const deadlineAt =
    patch.deadlineAt === undefined ? existing.deadlineAt : patch.deadlineAt;
  const callbackToken =
    patch.callbackToken === undefined
      ? existing.callbackToken
      : patch.callbackToken;
  db.prepare(
    `UPDATE agent_workflow_instance
     SET status = ?, current_state = ?, context_json = ?, attempt_count = ?,
         deadline_at = ?, callback_token = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    status,
    currentState,
    JSON.stringify(contextJson),
    attemptCount,
    deadlineAt,
    callbackToken,
    now,
    id,
  );
  return readWorkflowInstanceSync(id);
}

export function findWorkflowInstanceByCallbackTokenSync(
  workspaceId: string,
  token: string,
): WorkflowInstanceRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM agent_workflow_instance
       WHERE workspace_id = ? AND callback_token = ? LIMIT 1`,
    )
    .get(workspaceId, token) as InstanceRow | undefined;
  return row ? mapInstanceRow(row) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// History
// ────────────────────────────────────────────────────────────────────────────

export function recordWorkflowHistorySync(
  input: RecordWorkflowHistoryInput,
): WorkflowHistoryRecord {
  const db = getDatabase();
  const id = `wfh_${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_workflow_history (
      id, workspace_id, instance_id, event_type, from_state, to_state,
      payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.instanceId,
    input.eventType,
    input.fromState ?? null,
    input.toState ?? null,
    JSON.stringify(input.payloadJson ?? {}),
    now,
  );
  return {
    id,
    workspaceId: input.workspaceId,
    instanceId: input.instanceId,
    eventType: input.eventType,
    fromState: input.fromState ?? null,
    toState: input.toState ?? null,
    payloadJson: input.payloadJson ?? {},
    createdAt: now,
  };
}

export function listWorkflowHistorySync(
  instanceId: string,
): WorkflowHistoryRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM agent_workflow_history WHERE instance_id = ? ORDER BY created_at ASC`,
    )
    .all(instanceId) as HistoryRow[];
  return rows.map(mapHistoryRow);
}
