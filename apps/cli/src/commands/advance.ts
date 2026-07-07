// L4.4 — `agent-space-workflow-test advance <instance-id> --event <name>`.
//
// Mirrors the L4.1 daemon path: read instance → read definition →
// executeTransition → withTransaction(update + recordHistory). Exposed
// as a function (advanceInstance) so the e2e test in workflow.test.ts
// can call it directly with mocked DB if needed, but the primary
// entry point is the CLI subcommand.

import {
  readWorkflowInstanceSync,
  readWorkflowDefinitionSync,
  updateWorkflowInstanceStateSync,
  recordWorkflowHistorySync,
  listWorkflowHistorySync,
  withTransaction,
} from "@agent-space/db";
import { executeTransition } from "@agent-space/services";
import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowInstance,
} from "@agent-space/domain/workflows";
import type {
  WorkflowInstanceRecord,
} from "@agent-space/db";
import type { SubcommandResult, ParsedArgs } from "../workflow.ts";

export function advanceCommand(parsed: ParsedArgs): SubcommandResult {
  const instanceId = parsed.positional[0];
  if (!instanceId) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "advance: missing <instance-id> argument",
    };
  }
  const event = parsed.flags.event;
  if (!event) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "advance: missing --event <name> flag",
    };
  }
  let payload: Record<string, unknown> | undefined;
  const payloadStr = parsed.flags.payload;
  if (payloadStr !== undefined) {
    try {
      const obj = JSON.parse(payloadStr);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "advance: --payload must be a JSON object",
        };
      }
      payload = obj as Record<string, unknown>;
    } catch (err) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `advance: invalid --payload JSON: ${(err as Error).message}`,
      };
    }
  }

  try {
    const result = advanceInstance({
      workspaceId: parsed.flags.workspace ?? "default",
      instanceId,
      event,
      payload,
    });
    return {
      exitCode: result.transitioned ? 0 : 2,
      stdout: formatAdvanceResult(result),
      stderr: result.transitioned
        ? ""
        : `advance: transition did not fire (reason=${result.reason ?? "unknown"})`,
    };
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `advance: ${(err as Error).message}`,
    };
  }
}

function formatAdvanceResult(result: {
  instanceId: string;
  currentState: string;
  status: string;
  transitioned: boolean;
  historyCount: number;
  reason?: string;
  error?: string;
}): string {
  return [
    `instance:    ${result.instanceId}`,
    `state:       ${result.currentState}`,
    `status:      ${result.status}`,
    `transitioned: ${result.transitioned}`,
    `history:     ${result.historyCount}`,
    result.reason ? `reason:      ${result.reason}` : "",
    result.error ? `error:       ${result.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Shared logic, exported for reuse + testing ───────────────────────────────

export interface AdvanceInstanceInput {
  workspaceId: string;
  instanceId: string;
  event: string;
  payload?: Record<string, unknown>;
}

export interface AdvanceInstanceResult {
  instanceId: string;
  currentState: string;
  status: WorkflowInstanceRecord["status"];
  transitioned: boolean;
  historyCount: number;
  reason?: string;
  error?: string;
}

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
    throw new Error(`WorkflowDefinition not found: ${inst.definitionId}`);
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
      updateWorkflowInstanceStateSync(inst.id, {
        status: dbStatus,
        currentState: nextInst.currentState,
        contextJson: nextInst.context,
        attemptCount,
      });
      const lastHistory = nextInst.history[nextInst.history.length - 1];
      recordWorkflowHistorySync({
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
      });
    } else {
      const eventType = result.reason ?? "no_transition";
      recordWorkflowHistorySync({
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
      });
    }
  });

  const historyCount = listWorkflowHistorySync(inst.id).length;
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

// ── helpers ─────────────────────────────────────────────────────────────────

/** Same terminal-state check the L4.1 daemon uses. A state is
 *  "terminal" when it has no outgoing transitions and is not the
 *  error/timeout/awaiting-callback state. The runtime does not
 *  promote status to "completed" automatically — we check here at
 *  the persistence boundary. */
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