// FSM L4.1 — Task type definitions for the daemon test.
//
// The daemon's job is to take a task (one row of agent_task_queue in the
// prod schema) and execute it. For the L4.1 close-out we support two
// task types: "workflow" (create + advance a workflow instance) and
// "noop" (placeholder for tasks that don't need FSM execution).
//
// Real production tasks will be richer (notify-channel, invoke-agent,
// update-doc, etc., per the L4 brief in fsm-step-2-runbook.md). For
// now we keep the surface minimal: a workflow task is the only one
// that touches the FSM runtime.

export type TaskType = "workflow" | "noop";

/**
 * Generic task input. The daemon dispatches on `taskType`; fields below
 * are only meaningful for "workflow" tasks but kept at the top level
 * for ergonomic call sites.
 */
export interface TaskInput {
  workspaceId: string;
  taskType: TaskType;
  /** workflow taskType only */
  definitionId?: string;
  /** workflow taskType only — when present, advance existing instance */
  instanceId?: string;
  /** workflow taskType only — channel/contact routing metadata */
  channelName?: string;
  contactId?: string;
  /** workflow taskType only — initial contextJson for new instances */
  inputJson?: Record<string, unknown>;
  /** workflow taskType only — event to fire on the instance */
  event?: WorkflowEventSpec;
}

/**
 * Event spec the daemon translates into a runtime WorkflowEvent.
 * We keep this surface tight: START or SIGNAL. CALLBACK/TIMEOUT/CANCEL
 * are out of scope for L4.1.
 */
export interface WorkflowEventSpec {
  type: "START" | "SIGNAL";
  /** Required for SIGNAL — the signal name to fire */
  signal?: string;
  /** Optional payload merged into instance.context on the event */
  payload?: Record<string, unknown>;
}

export interface TaskOutput {
  ok: boolean;
  taskType: TaskType;
  /** workflow: the workflow result. noop: undefined. */
  result?: unknown;
  error?: string;
}
