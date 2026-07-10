// FSM P2-2 — Task type definitions for the daemon test.
//
// The daemon's job is to take a task (one row of agent_task_queue in
// the prod schema) and execute it. We support a small set of task
// types:
//
//   - "workflow"        (L4.1)  create + advance a workflow instance
//   - "noop"            (L4.1)  placeholder for tasks that don't need
//                               any handler logic
//   - "update-doc"      (P2-2)  write content to a workspace-scoped
//                               document (file in .data/docs/)
//   - "notify-channel"  (P2-2)  send a message to a channel — stub
//                               via console.log + deliveryId
//   - "invoke-agent"    (P2-2)  prompt an LLM-backed agent — echo
//                               stub here, real backend wired in prod
//
// Real production tasks (per the L4 brief in fsm-step-2-runbook.md)
// will be richer still; for the P2-2 close-out we cover the three
// handlers commonly needed alongside FSM workflow firing so the
// scheduler can drive a realistic pipeline.

export type TaskType =
  | "workflow"
  | "noop"
  | "update-doc"
  | "notify-channel"
  | "invoke-agent";

/**
 * Generic task input. The daemon dispatches on `taskType`; field
 * presence below depends on the type. Workflow fields stay at the top
 * level for the L4.1 ergonomic call sites; new types add their own
 * fields here.
 */
export interface TaskInput {
  workspaceId: string;
  taskType: TaskType;

  // ── workflow fields (L4.1) ─────────────────────────────────────────
  /** workflow only */
  definitionId?: string;
  /** workflow only — when present, advance existing instance */
  instanceId?: string;
  /** workflow only — channel/contact routing metadata */
  channelName?: string;
  contactId?: string;
  /** workflow only — initial contextJson for new instances */
  inputJson?: Record<string, unknown>;
  /** workflow only — event to fire on the instance */
  event?: WorkflowEventSpec;

  // ── update-doc fields (P2-2) ───────────────────────────────────────
  /** update-doc only — logical document id within the workspace */
  docId?: string;
  /** update-doc only — body to write */
  content?: string;
  /** update-doc only — file extension hint; default "json" */
  format?: "json" | "text" | "markdown";

  // ── notify-channel fields (P2-2) ───────────────────────────────────
  /** notify-channel only — channel name (e.g. "im_default") */
  channel?: string;
  /** notify-channel only — message body to deliver */
  message?: string;

  // ── invoke-agent fields (P2-2) ─────────────────────────────────────
  /** invoke-agent only — target agent id (e.g. "as-manager") */
  agentId?: string;
  /** invoke-agent only — prompt to send to the agent */
  prompt?: string;
}

/**
 * Event spec the daemon translates into a runtime WorkflowEvent.
 * Workflow type only. Tight: START or SIGNAL. CALLBACK/TIMEOUT/CANCEL
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
  /** Handler-specific result; shape depends on taskType. */
  result?: unknown;
  error?: string;
}
