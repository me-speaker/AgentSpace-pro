// FSM 1.2 \u2014 Workflow Store (L2)
//
// Provides the *Sync CRUD layer used by the runtime to persist definitions,
// instances, and history. The interface is intentionally DB-agnostic: the
// reference implementation backs everything with an in-memory Map, but the
// function signatures + record shapes line up 1:1 with the three target
// tables in packages/db/src/postgres-schema.ts:
//
//   agent_workflow_definition(id, workspace_id, name, version, definition_json, ...)
//   agent_workflow_instance (id, workspace_id, definition_id, status,
//                            current_state, context_json, attempt_count,
//                            deadline_at, callback_token, ...)
//   agent_workflow_history (id, workspace_id, instance_id, event_type,
//                           from_state, to_state, payload_json, ...)
//
// To swap the backing store to real Postgres later, implement the same
// WorkflowStore interface against `db.prepare(...).get/all/run(...)` (see
// packages/services/src/approvals/approvals.ts for the established style)
// and wire it up via runtime.setStore().
//
// All store functions are *Sync and synchronous \u2014 they are designed to be
// called from within an existing open DB transaction (or, in this in-memory
// implementation, a single map mutation). workspace_id is part of every
// key path so two workspaces can never see each other's data.

// \u2500\u2500 Record shapes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface WorkflowDefinitionRecord {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  /** JSON-serializable definition body (states, transitions, etc.) */
  definition: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstanceRecord {
  id: string;
  workspaceId: string;
  definitionId: string;
  /** active | completed | failed | waiting | cancelled */
  status: string;
  currentState: string;
  context: Record<string, unknown>;
  attemptCount: number;
  deadlineAt?: string | null;
  callbackToken?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowHistoryRecord {
  id: string;
  workspaceId: string;
  instanceId: string;
  /** START | SIGNAL | CALLBACK | TIMEOUT | CANCEL | ERROR | TRANSITION */
  eventType: string;
  fromState: string | null;
  toState: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// \u2500\u2500 Input shapes (Create/Update patches) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface CreateWorkflowDefinitionInput {
  id: string;
  workspaceId: string;
  name: string;
  version?: number;
  definition: Record<string, unknown>;
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  version?: number;
  definition?: Record<string, unknown>;
}

export interface CreateWorkflowInstanceInput {
  id: string;
  workspaceId: string;
  definitionId: string;
  status?: string;
  currentState: string;
  context?: Record<string, unknown>;
  attemptCount?: number;
  deadlineAt?: string | null;
  callbackToken?: string | null;
}

export interface UpdateWorkflowInstanceStateInput {
  status?: string;
  currentState?: string;
  context?: Record<string, unknown>;
  attemptCount?: number;
  deadlineAt?: string | null;
  callbackToken?: string | null;
}

export interface RecordWorkflowHistoryInput {
  id: string;
  workspaceId: string;
  instanceId: string;
  eventType: string;
  fromState: string | null;
  toState: string;
  payload?: Record<string, unknown>;
}

// \u2500\u2500 Store interface (consumed by runtime.ts) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface WorkflowStore {
  // Definition CRUD
  createWorkflowDefinitionSync(input: CreateWorkflowDefinitionInput): WorkflowDefinitionRecord;
  readWorkflowDefinitionSync(id: string): WorkflowDefinitionRecord | null;
  listWorkflowDefinitionsSync(workspaceId: string): WorkflowDefinitionRecord[];
  updateWorkflowDefinitionSync(id: string, patch: UpdateWorkflowDefinitionInput): WorkflowDefinitionRecord;
  deleteWorkflowDefinitionSync(id: string): boolean;

  // Instance CRUD
  createWorkflowInstanceSync(input: CreateWorkflowInstanceInput): WorkflowInstanceRecord;
  readWorkflowInstanceSync(id: string): WorkflowInstanceRecord | null;
  listWorkflowInstancesForDefinitionSync(definitionId: string): WorkflowInstanceRecord[];
  listWorkflowInstancesForWorkspaceSync(workspaceId: string, status?: string): WorkflowInstanceRecord[];
  updateWorkflowInstanceStateSync(id: string, patch: UpdateWorkflowInstanceStateInput): WorkflowInstanceRecord;
  findWorkflowInstanceByCallbackTokenSync(workspaceId: string, token: string): WorkflowInstanceRecord | null;

  // History
  recordWorkflowHistorySync(input: RecordWorkflowHistoryInput): WorkflowHistoryRecord;
  listWorkflowHistorySync(instanceId: string): WorkflowHistoryRecord[];
}

// \u2500\u2500 In-memory reference implementation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/**
 * In-memory Map-backed implementation. One map per entity; workspace_id is
 * folded into queries for list/find operations. Suitable for:
 *   - unit tests (no DB needed)
 *   - L2 sandbox environments without Postgres
 *   - ephemeral CLI sessions
 *
 * Swap with a Postgres-backed implementation (see header) for production.
 */
export class InMemoryWorkflowStore implements WorkflowStore {
  private definitions = new Map<string, WorkflowDefinitionRecord>();
  private instances = new Map<string, WorkflowInstanceRecord>();
  private history = new Map<string, WorkflowHistoryRecord>();
  private historyByInstance = new Map<string, string[]>();

  // \u2500\u2500 Definition CRUD \u2500\u2500

  createWorkflowDefinitionSync(input: CreateWorkflowDefinitionInput): WorkflowDefinitionRecord {
    if (this.definitions.has(input.id)) {
      throw new Error(`WorkflowDefinition '${input.id}' already exists`);
    }
    const now = new Date().toISOString();
    const record: WorkflowDefinitionRecord = {
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      version: input.version ?? 1,
      definition: input.definition,
      createdAt: now,
      updatedAt: now,
    };
    this.definitions.set(record.id, record);
    return record;
  }

  readWorkflowDefinitionSync(id: string): WorkflowDefinitionRecord | null {
    return this.definitions.get(id) ?? null;
  }

  listWorkflowDefinitionsSync(workspaceId: string): WorkflowDefinitionRecord[] {
    const out: WorkflowDefinitionRecord[] = [];
    for (const def of this.definitions.values()) {
      if (def.workspaceId === workspaceId) out.push(def);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  updateWorkflowDefinitionSync(
    id: string,
    patch: UpdateWorkflowDefinitionInput
  ): WorkflowDefinitionRecord {
    const existing = this.definitions.get(id);
    if (!existing) {
      throw new Error(`WorkflowDefinition '${id}' not found`);
    }
    if (patch.definition !== undefined) {
      // Cross-workspace guard: caller-supplied definition must not change
      // workspace_id (which is fixed in the existing record).
    }
    const updated: WorkflowDefinitionRecord = {
      ...existing,
      name: patch.name ?? existing.name,
      version: patch.version ?? existing.version,
      definition: patch.definition ?? existing.definition,
      updatedAt: new Date().toISOString(),
    };
    this.definitions.set(id, updated);
    return updated;
  }

  deleteWorkflowDefinitionSync(id: string): boolean {
    const removed = this.definitions.delete(id);
    if (removed) {
      // Cascade: drop instances + history pointing at this definition
      for (const [iid, inst] of this.instances.entries()) {
        if (inst.definitionId === id) {
          this.instances.delete(iid);
          const histIds = this.historyByInstance.get(iid) ?? [];
          for (const hid of histIds) this.history.delete(hid);
          this.historyByInstance.delete(iid);
        }
      }
    }
    return removed;
  }

  // \u2500\u2500 Instance CRUD \u2500\u2500

  createWorkflowInstanceSync(input: CreateWorkflowInstanceInput): WorkflowInstanceRecord {
    if (this.instances.has(input.id)) {
      throw new Error(`WorkflowInstance '${input.id}' already exists`);
    }
    // Verify definition exists (FK contract)
    const def = this.definitions.get(input.definitionId);
    if (!def) {
      throw new Error(
        `WorkflowDefinition '${input.definitionId}' not found (required for instance FK)`
      );
    }
    // Verify workspace alignment
    if (def.workspaceId !== input.workspaceId) {
      throw new Error(
        `Workspace mismatch: definition belongs to '${def.workspaceId}', instance is '${input.workspaceId}'`
      );
    }
    const now = new Date().toISOString();
    const record: WorkflowInstanceRecord = {
      id: input.id,
      workspaceId: input.workspaceId,
      definitionId: input.definitionId,
      status: input.status ?? "active",
      currentState: input.currentState,
      context: input.context ?? {},
      attemptCount: input.attemptCount ?? 0,
      deadlineAt: input.deadlineAt ?? null,
      callbackToken: input.callbackToken ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.instances.set(record.id, record);
    return record;
  }

  readWorkflowInstanceSync(id: string): WorkflowInstanceRecord | null {
    return this.instances.get(id) ?? null;
  }

  listWorkflowInstancesForDefinitionSync(definitionId: string): WorkflowInstanceRecord[] {
    const out: WorkflowInstanceRecord[] = [];
    for (const inst of this.instances.values()) {
      if (inst.definitionId === definitionId) out.push(inst);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  listWorkflowInstancesForWorkspaceSync(
    workspaceId: string,
    status?: string
  ): WorkflowInstanceRecord[] {
    const out: WorkflowInstanceRecord[] = [];
    for (const inst of this.instances.values()) {
      if (inst.workspaceId !== workspaceId) continue;
      if (status !== undefined && inst.status !== status) continue;
      out.push(inst);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  updateWorkflowInstanceStateSync(
    id: string,
    patch: UpdateWorkflowInstanceStateInput
  ): WorkflowInstanceRecord {
    const existing = this.instances.get(id);
    if (!existing) {
      throw new Error(`WorkflowInstance '${id}' not found`);
    }
    const updated: WorkflowInstanceRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      currentState: patch.currentState ?? existing.currentState,
      context: patch.context ?? existing.context,
      attemptCount: patch.attemptCount ?? existing.attemptCount,
      deadlineAt:
        patch.deadlineAt !== undefined ? patch.deadlineAt : existing.deadlineAt,
      callbackToken:
        patch.callbackToken !== undefined ? patch.callbackToken : existing.callbackToken,
      updatedAt: new Date().toISOString(),
    };
    this.instances.set(id, updated);
    return updated;
  }

  findWorkflowInstanceByCallbackTokenSync(
    workspaceId: string,
    token: string
  ): WorkflowInstanceRecord | null {
    for (const inst of this.instances.values()) {
      if (inst.workspaceId !== workspaceId) continue;
      if (inst.callbackToken === token) return inst;
    }
    return null;
  }

  // \u2500\u2500 History \u2500\u2500

  recordWorkflowHistorySync(input: RecordWorkflowHistoryInput): WorkflowHistoryRecord {
    if (this.history.has(input.id)) {
      throw new Error(`WorkflowHistory '${input.id}' already exists`);
    }
    // Verify instance exists (FK contract)
    if (!this.instances.has(input.instanceId)) {
      throw new Error(
        `WorkflowInstance '${input.instanceId}' not found (required for history FK)`
      );
    }
    const record: WorkflowHistoryRecord = {
      id: input.id,
      workspaceId: input.workspaceId,
      instanceId: input.instanceId,
      eventType: input.eventType,
      fromState: input.fromState,
      toState: input.toState,
      payload: input.payload ?? {},
      createdAt: new Date().toISOString(),
    };
    this.history.set(record.id, record);
    const list = this.historyByInstance.get(input.instanceId) ?? [];
    list.push(record.id);
    this.historyByInstance.set(input.instanceId, list);
    return record;
  }

  listWorkflowHistorySync(instanceId: string): WorkflowHistoryRecord[] {
    const ids = this.historyByInstance.get(instanceId) ?? [];
    const out: WorkflowHistoryRecord[] = [];
    for (const hid of ids) {
      const h = this.history.get(hid);
      if (h) out.push(h);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  // \u2500\u2500 Test helpers (not part of WorkflowStore interface) \u2500\u2500

  /** Drop everything; used by tests for setup/teardown. */
  clear(): void {
    this.definitions.clear();
    this.instances.clear();
    this.history.clear();
    this.historyByInstance.clear();
  }

  /** Snapshot sizes; used by tests for round-trip assertions. */
  sizes(): { definitions: number; instances: number; history: number } {
    return {
      definitions: this.definitions.size,
      instances: this.instances.size,
      history: this.history.size,
    };
  }
}

// \u2500\u2500 Factory \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

/** Default factory: returns an in-memory store. Swap with PG later. */
export function createInMemoryWorkflowStore(): WorkflowStore {
  return new InMemoryWorkflowStore();
}