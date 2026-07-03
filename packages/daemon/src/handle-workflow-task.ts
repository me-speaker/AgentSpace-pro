// FSM L4.1 — Workflow task handler
//
// handleWorkflowTask() bridges the persistent DB layer (@agent-space/db)
// and the in-memory FSM runtime (@agent-space/services).
//
// Lifecycle (per call):
//   1. Read the workflow definition from DB. Reject cross-workspace use.
//   2. Resolve the instance: either read existing (when `instanceId`
//      is provided) or create a new one at the definition's initialState.
//   3. If no event is provided, return immediately — the call is treated
//      as a "spawn only" task (used by the L4.2 scheduler).
//   4. Build an in-memory WorkflowInstance from the DB record and call
//      executeTransition() with the event.
//   5. Persist the result: update the instance row + record a history
//      row. A failed transition is recorded as eventType="guard_fail"
//      so callers can distinguish it from a successful SIGNAL row.
//
// We intentionally do NOT call runtime.setStore(). The runtime's internal
// persistence is disabled by default; the daemon owns the write path
// to the DB so we have exactly one source of truth per call.
//
// Status mapping: the runtime uses WorkflowStatus = "idle" | "running"
// | "waiting" | "completed" | "failed" | "cancelled". The DB record uses
// "active" for what the runtime calls "running" + "idle" (the L2 store
// schema treats both as "active"). The conversion is in
// `toStoreStatus()` below.

import {
  createWorkflowInstanceSync,
  readWorkflowInstanceSync,
  readWorkflowDefinitionSync,
  updateWorkflowInstanceStateSync,
  recordWorkflowHistorySync,
  listWorkflowHistorySync,
  type WorkflowInstanceRecord,
} from "@agent-space/db";
import { executeTransition } from "@agent-space/services";
import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowEvent,
} from "@agent-space/domain/workflows";
import type { WorkflowEventSpec } from "./task-types.ts";

// ── Public types ─────────────────────────────────────────────────────────────

export interface HandleWorkflowTaskInput {
  workspaceId: string;
  definitionId: string;
  /** When provided, advance the existing instance instead of creating a new one. */
  instanceId?: string;
  channelName?: string;
  contactId?: string;
  /** Initial contextJson for new instances. Ignored when advancing existing. */
  inputJson?: Record<string, unknown>;
  /** When provided, fire this event after instance creation/resolution. */
  event?: WorkflowEventSpec;
}

export interface HandleWorkflowTaskResult {
  instanceId: string;
  currentState: string;
  status: "active" | "completed" | "failed" | "waiting" | "cancelled";
  transitioned: boolean;
  /** Total history rows on the instance after this call. */
  historyCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Runtime WorkflowStatus → DB WorkflowInstanceRecord.status */
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

/**
 * A state is "terminal" when it has no outgoing transitions and is not
 * the error/timeout state. The runtime does not promote the status to
 * "completed" automatically (it only flips to "waiting"/"failed"), so
 * the daemon checks for terminal-state promotion at the persistence
 * boundary.
 */
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

/**
 * Build an in-memory WorkflowInstance from a DB WorkflowInstanceRecord.
 * The runtime fields `attempts`, `history`, and `variables` are reset to
 * empty — the runtime manages them as it executes transitions, and the
 * daemon mirrors the relevant bits back to the DB at the end of the call.
 */
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

function specToWorkflowEvent(spec: WorkflowEventSpec): WorkflowEvent {
  if (spec.type === "START") {
    return { type: "START", payload: spec.payload };
  }
  return {
    type: "SIGNAL",
    signal: spec.signal ?? "__unspecified",
    payload: spec.payload,
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function handleWorkflowTask(
  input: HandleWorkflowTaskInput,
): HandleWorkflowTaskResult {
  // 1. Read the definition + enforce workspace isolation.
  const defRecord = readWorkflowDefinitionSync(input.definitionId);
  if (!defRecord) {
    throw new Error(
      `WorkflowDefinition not found: ${input.definitionId}`,
    );
  }
  if (defRecord.workspaceId !== input.workspaceId) {
    throw new Error(
      `WorkflowDefinition ${input.definitionId} does not belong to workspace ${input.workspaceId} (belongs to ${defRecord.workspaceId})`,
    );
  }
  const def = defRecord.definitionJson as unknown as WorkflowDefinition;

  // 2. Resolve the instance — either advance existing or create new.
  //    `createdHere` tracks whether we just created the instance (so
  //    step 5 knows whether to record a START history row). START is
  //    recorded only when we create the instance in this call AND an
  //    event is being fired — the L4.2 "spawn only" path (no event)
  //    stays history-free, matching the L4.5 e2e step 2.
  let instRecord: WorkflowInstanceRecord;
  let createdHere = false;
  if (input.instanceId !== undefined) {
    const existing = readWorkflowInstanceSync(input.instanceId);
    if (!existing) {
      throw new Error(
        `WorkflowInstance not found: ${input.instanceId}`,
      );
    }
    if (existing.workspaceId !== input.workspaceId) {
      throw new Error(
        `WorkflowInstance ${input.instanceId} does not belong to workspace ${input.workspaceId} (belongs to ${existing.workspaceId})`,
      );
    }
    instRecord = existing;
  } else {
    instRecord = createWorkflowInstanceSync({
      workspaceId: input.workspaceId,
      definitionId: input.definitionId,
      currentState: def.initialState,
      contextJson: input.inputJson ?? {},
    });
    createdHere = true;
  }

  // 3. No event → "spawn only" mode. Return the freshly created (or
  // existing) instance. The L4.2 scheduler uses this path.
  if (input.event === undefined) {
    const fresh = readWorkflowInstanceSync(instRecord.id)!;
    return {
      instanceId: instRecord.id,
      currentState: fresh.currentState,
      status: fresh.status,
      transitioned: false,
      historyCount: listWorkflowHistorySync(instRecord.id).length,
    };
  }

  // 4. Run the FSM step.
  const runtimeInst = buildRuntimeInstance(instRecord, def);
  const workflowEvent = specToWorkflowEvent(input.event);
  const { instance: nextInst, result } = executeTransition(
    runtimeInst,
    workflowEvent,
    def,
  );

  // 5. Persist results.
  //    When we created the instance in this call, also record a START
  //    history row before the event row — that gives us START + event
  //    = 2 rows for a fresh transition (matches the L4.1 spec).
  if (createdHere) {
    recordWorkflowHistorySync({
      workspaceId: input.workspaceId,
      instanceId: instRecord.id,
      eventType: "START",
      fromState: null,
      toState: def.initialState,
      payloadJson: { inputJson: input.inputJson ?? {} },
    });
  }
  if (result.transitioned) {
    let dbStatus = toStoreStatus(nextInst.status);
    if (isTerminalState(def, nextInst.currentState)) {
      dbStatus = "completed";
    }
    const attemptCount = Object.values(nextInst.attempts).reduce(
      (sum, n) => sum + n,
      0,
    );
    updateWorkflowInstanceStateSync(instRecord.id, {
      status: dbStatus,
      currentState: nextInst.currentState,
      contextJson: nextInst.context,
      attemptCount,
    });
    const lastHistory = nextInst.history[nextInst.history.length - 1];
    const eventLabel = input.event.signal ?? input.event.type;
    recordWorkflowHistorySync({
      workspaceId: input.workspaceId,
      instanceId: instRecord.id,
      eventType: eventLabel,
      fromState: lastHistory?.fromState ?? null,
      toState: lastHistory?.toState ?? nextInst.currentState,
      payloadJson: {
        transitionId: lastHistory?.transitionId ?? null,
        guardResults: lastHistory?.guardResults ?? {},
        actionResults: lastHistory?.actionResults ?? {},
      },
    });
  } else {
    // No matching transition (which includes "guard denied" — the
    // runtime's findTransition() returns null when guards fail).
    recordWorkflowHistorySync({
      workspaceId: input.workspaceId,
      instanceId: instRecord.id,
      eventType: "guard_fail",
      fromState: runtimeInst.currentState,
      toState: null,
      payloadJson: {
        event: input.event,
        error: result.error ?? "no matching transition",
      },
    });
  }

  // 6. Re-read and return the final state.
  const finalRecord = readWorkflowInstanceSync(instRecord.id)!;
  return {
    instanceId: instRecord.id,
    currentState: finalRecord.currentState,
    status: finalRecord.status,
    transitioned: result.transitioned,
    historyCount: listWorkflowHistorySync(instRecord.id).length,
  };
}
