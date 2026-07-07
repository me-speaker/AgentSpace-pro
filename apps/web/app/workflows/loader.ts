// L4.3 — workflow data loaders.
//
// Pure functions that call @agent-space/db CRUD and return plain
// records. Separated from the page renderers so:
//   1. Tests can mock @agent-space/db and assert calls.
//   2. Server actions / API routes can reuse the same loaders.
//
// All loaders are workspace-scoped per the L2 store contract.

import {
  listWorkflowDefinitionsSync,
  listWorkflowInstancesForWorkspaceSync,
  listWorkflowInstancesForDefinitionSync,
  readWorkflowDefinitionSync,
  readWorkflowInstanceSync,
  listWorkflowHistorySync,
  withTransaction,
  recordWorkflowHistorySync,
  updateWorkflowInstanceStateSync,
  createWorkflowDefinitionSync,
  createWorkflowInstanceSync,
  type WorkflowDefinitionRecord,
  type WorkflowInstanceRecord,
  type WorkflowHistoryRecord,
  type UpdateWorkflowInstanceStateInput,
  type RecordWorkflowHistoryInput,
} from "@agent-space/db";
import { executeTransition } from "@agent-space/services";
import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInstance,
} from "@agent-space/domain/workflows";

// ── List loaders ────────────────────────────────────────────────────────────

export interface WorkflowsListData {
  workspaceId: string;
  definitions: WorkflowDefinitionRecord[];
  instances: WorkflowInstanceRecord[];
}

export function loadWorkflowsList(workspaceId: string): WorkflowsListData {
  return {
    workspaceId,
    definitions: listWorkflowDefinitionsSync(workspaceId),
    instances: listWorkflowInstancesForWorkspaceSync(workspaceId),
  };
}

// ── Definition detail loader ─────────────────────────────────────────────────

export interface DefinitionDetailData {
  definition: WorkflowDefinitionRecord | null;
  instances: WorkflowInstanceRecord[];
}

export function loadDefinitionDetail(
  definitionId: string,
): DefinitionDetailData {
  const definition = readWorkflowDefinitionSync(definitionId);
  if (!definition) {
    return { definition: null, instances: [] };
  }
  const instances = listWorkflowInstancesForDefinitionSync(definitionId);
  return { definition, instances };
}

// ── Instance detail loader ───────────────────────────────────────────────────

export interface InstanceDetailData {
  instance: WorkflowInstanceRecord | null;
  definition: WorkflowDefinitionRecord | null;
  history: WorkflowHistoryRecord[];
}

export function loadInstanceDetail(
  instanceId: string,
): InstanceDetailData {
  const instance = readWorkflowInstanceSync(instanceId);
  if (!instance) {
    return { instance: null, definition: null, history: [] };
  }
  const definition = readWorkflowDefinitionSync(instance.definitionId);
  const history = listWorkflowHistorySync(instanceId);
  return { instance, definition, history };
}

// ── Mutation helpers (used by actions + directly by tests) ──────────────────

export interface CreateWorkflowInput {
  workspaceId: string;
  name: string;
  version?: number;
  definitionJson: Record<string, unknown>;
}

export function createWorkflowDefinition(
  input: CreateWorkflowInput,
): WorkflowDefinitionRecord {
  // Uses the *Sync CRUD imported at the top of the file. Tests mock
  // the @agent-space/db module via Node's mock.module and this call
  // is intercepted. We still pull a fresh binding inside the function
  // body (defensive — if a test sets a mock after module load, this
  // re-reads the live binding).
  return createWorkflowDefinitionSync({
    workspaceId: input.workspaceId,
    name: input.name,
    version: input.version,
    definitionJson: input.definitionJson,
  });
}

export interface AdvanceInstanceInput {
  workspaceId: string;
  instanceId: string;
  event: string; // event name to fire (e.g. "approve", "start_draft")
  payload?: Record<string, unknown>;
}

export interface AdvanceInstanceResult {
  instanceId: string;
  currentState: string;
  status: WorkflowInstanceRecord["status"];
  transitioned: boolean;
  historyCount: number;
  /** Structured failure reason when transitioned=false. P0-3. */
  reason?: string;
  error?: string;
}

// ── Daemon-mirroring advance path ────────────────────────────────────────────
//
// Mirrors handleWorkflowTask() in @agent-space/daemon-test but exposed
// for server actions + tests. Wraps the writes in withTransaction()
// per P0-2.

export function advanceInstance(
  input: AdvanceInstanceInput,
): AdvanceInstanceResult {
  const inst = readWorkflowInstanceSync(input.instanceId);
  if (!inst) {
    throw new Error(`WorkflowInstance not found: ${input.instanceId}`);
  }
  if (inst.workspaceId !== input.workspaceId) {
    throw new Error(
      `WorkflowInstance ${input.instanceId} does not belong to workspace ${input.workspaceId} (belongs to ${inst.workspaceId})`,
    );
  }
  const defRecord = readWorkflowDefinitionSync(inst.definitionId);
  if (!defRecord) {
    throw new Error(
      `WorkflowDefinition not found: ${inst.definitionId}`,
    );
  }
  const def = defRecord.definitionJson as unknown as WorkflowDefinition;

  const runtimeInst = buildRuntimeInstance(inst, def);
  const workflowEvent: WorkflowEvent = {
    type: "SIGNAL",
    signal: input.event,
    payload: input.payload,
  };
  const { instance: nextInst, result } = executeTransition(
    runtimeInst,
    workflowEvent,
    def,
  );

  let historyCount = listWorkflowHistorySync(inst.id).length;

  withTransaction(() => {
    if (result.transitioned) {
      let dbStatus = toStoreStatus(nextInst.status);
      if (isTerminalState(def, nextInst.currentState)) {
        dbStatus = "completed";
      }
      const attemptCount = Object.values(nextInst.attempts).reduce(
        (sum, n) => sum + n,
        0,
      );
      const updatePatch: UpdateWorkflowInstanceStateInput = {
        status: dbStatus,
        currentState: nextInst.currentState,
        contextJson: nextInst.context,
        attemptCount,
      };
      updateWorkflowInstanceStateSync(inst.id, updatePatch);
      const lastHistory = nextInst.history[nextInst.history.length - 1];
      const histPatch: RecordWorkflowHistoryInput = {
        workspaceId: input.workspaceId,
        instanceId: inst.id,
        eventType: input.event,
        fromState: lastHistory?.fromState ?? null,
        toState: lastHistory?.toState ?? nextInst.currentState,
        payloadJson: {
          transitionId: lastHistory?.transitionId ?? null,
          guardResults: lastHistory?.guardResults ?? {},
          actionResults: lastHistory?.actionResults ?? {},
        },
      };
      recordWorkflowHistorySync(histPatch);
    } else {
      const eventType = result.reason ?? "no_transition";
      const histPatch: RecordWorkflowHistoryInput = {
        workspaceId: input.workspaceId,
        instanceId: inst.id,
        eventType,
        fromState: runtimeInst.currentState,
        toState: null,
        payloadJson: {
          event: workflowEvent,
          reason: result.reason,
          error: result.error ?? "no matching transition",
        },
      };
      recordWorkflowHistorySync(histPatch);
    }
  });

  historyCount = listWorkflowHistorySync(inst.id).length;
  const finalInst = readWorkflowInstanceSync(inst.id)!;

  return {
    instanceId: inst.id,
    currentState: finalInst.currentState,
    status: finalInst.status,
    transitioned: result.transitioned,
    historyCount,
    reason: result.reason ?? undefined,
    error: result.error ?? undefined,
  };
}

// ── Internal helpers (kept inline; not exported) ────────────────────────────

/** Mirror of the daemon's terminal-state check. See
 *  packages/daemon/src/handle-workflow-task.ts. */
function isTerminalState(def: WorkflowDefinition, stateId: string): boolean {
  const state = def.states[stateId];
  if (!state) return false;
  if (state.awaitingCallback) return false;
  if (def.errorState && state.id === def.errorState) return false;
  if (def.timeoutState && state.id === def.timeoutState) return false;
  for (const t of Object.values(def.transitions)) {
    const fromStates = Array.isArray(t.from) ? t.from : [t.from];
    if (fromStates.includes(stateId) || fromStates.includes("*")) {
      return false;
    }
  }
  return true;
}

function toStoreStatus(
  runtimeStatus: string,
): "active" | "completed" | "failed" | "waiting" | "cancelled" {
  switch (runtimeStatus) {
    case "idle":
    case "running":
      return "active";
    case "waiting":
      return "waiting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}

function buildRuntimeInstance(
  record: WorkflowInstanceRecord,
  def: WorkflowDefinition,
): WorkflowInstance {
  return {
    id: record.id,
    definitionId: record.definitionId,
    definitionVersion: def.version,
    workspaceId: record.workspaceId,
    status:
      record.status === "active"
        ? "running"
        : (record.status as WorkflowInstance["status"]),
    currentState: record.currentState,
    context: record.contextJson,
    variables: {},
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attempts: {},
    history: [],
    callStack: [],
    callbackToken: record.callbackToken ?? undefined,
    deadline: record.deadlineAt ?? undefined,
  };
}

// ── Re-exports for test convenience ─────────────────────────────────────────

export { createWorkflowInstanceSync };