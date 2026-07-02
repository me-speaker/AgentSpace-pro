// FSM 1.1 — Workflow Schema Types
// AgentSpace Finite State Machine for workflow execution

export type WorkflowStatus = "idle" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type TransitionKind = "explicit" | "automatic" | "callback";

// ── Guard ───────────────────────────────────────────────────────────────────

export interface WorkflowGuard {
  id: string;
  label: string;
  /** JavaScript expression evaluated against `ctx` (sandboxed at runtime) */
  condition: string;
  /** If false, transition is skipped silently; if true and guard fails, transition fails */
  required?: boolean;
}

// ── Action ──────────────────────────────────────────────────────────────────

export type ActionPhase = "enter" | "exit" | "transition";

export interface WorkflowAction {
  id: string;
  label: string;
  /** Dot-notation path to service method, e.g. "tasks.create" */
  service: string;
  /** JSON-serializable args passed to the service method */
  args?: Record<string, unknown>;
  /** 'enter' runs after entering target state; 'exit' before leaving source; 'transition' wraps executeTransition */
  phase: ActionPhase;
  /** Continue workflow even if action throws */
  continueOnError?: boolean;
}

// ── Transition ───────────────────────────────────────────────────────────────

export interface WorkflowTransition {
  id: string;
  /** Source state(s); '*' means any state */
  from: string | string[];
  to: string;
  /** Event name that triggers this transition (null = automatic) */
  event?: string;
  /** Guards evaluated in order; all must pass */
  guards?: WorkflowGuard[];
  /** Actions run during transition */
  actions?: WorkflowAction[];
  /** 'explicit' = triggered by external signal; 'automatic' = auto-evaluated after state enter; 'callback' = async resume */
  kind: TransitionKind;
}

// ── State ───────────────────────────────────────────────────────────────────

export interface WorkflowState {
  id: string;
  label: string;
  /** Actions run when entering this state */
  entryActions?: WorkflowAction[];
  /** Actions run when exiting this state */
  exitActions?: WorkflowAction[];
  /** If true, state machine waits for external resume signal */
  awaitingCallback?: boolean;
  /** Timeout in ms; if exceeded in 'waiting' status, transition to onTimeout target */
  timeoutMs?: number;
  /** Transition taken automatically after entering (no event required) */
  autoTransition?: string;
}

// ── Definition (static schema) ───────────────────────────────────────────────

export interface WorkflowDefinition {
  id: string;
  version: string;
  label: string;
  description?: string;
  /** All states indexed by id */
  states: Record<string, WorkflowState>;
  /** All transitions indexed by id */
  transitions: Record<string, WorkflowTransition>;
  /** id of the initial state */
  initialState: string;
  /** State entered on workflow-level error */
  errorState?: string;
  /** State entered on timeout with no explicit handler */
  timeoutState?: string;
}

// ── History Entry ────────────────────────────────────────────────────────────

export interface WorkflowHistoryEntry {
  idx: number;
  timestamp: string; // ISO-8601
  fromState: string | null;
  toState: string;
  transitionId: string | null;
  eventName: string | null;
  guardResults?: Record<string, boolean>;
  actionResults?: Record<string, "ok" | "error">;
  error?: string;
}

// ── Instance (runtime) ───────────────────────────────────────────────────────

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  definitionVersion: string;
  workspaceId: string;
  status: WorkflowStatus;
  currentState: string;
  context: Record<string, unknown>;
  variables: Record<string, unknown>;
  /** Human-readable label set by creator */
  label?: string;
  createdAt: string;
  updatedAt: string;
  /** Monotonically increasing attempt counter per transition */
  attempts: Record<string, number>;
  /** Attempt cap per transition; exceeded → workflow fails */
  attemptLimit?: number;
  history: WorkflowHistoryEntry[];
  /** Stack of paused states for nested awaits */
  callStack: string[];
  /** External correlation token for callback resume */
  callbackToken?: string;
  /** ISO-8601 deadline for current 'waiting' state */
  deadline?: string;
  error?: string;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type WorkflowEvent =
  | { type: "START"; payload?: Record<string, unknown> }
  | { type: "SIGNAL"; signal: string; payload?: Record<string, unknown> }
  | { type: "CALLBACK"; token: string; payload?: Record<string, unknown> }
  | { type: "TIMEOUT" }
  | { type: "CANCEL"; reason?: string }
  | { type: "ERROR"; error: string };

// ── Transition Result ────────────────────────────────────────────────────────

export interface TransitionResult {
  /** true = state changed; false = stayed (guards blocked or no matching transition) */
  transitioned: boolean;
  toState: string | null;
  guardsPassed: boolean;
  actionsRun: Array<{ id: string; phase: ActionPhase; ok: boolean; error?: string }>;
  error?: string;
}

// ── Execution Log (for runtime audit) ───────────────────────────────────────

export interface WorkflowExecutionLog {
  instanceId: string;
  entries: Array<{
    timestamp: string;
    level: "info" | "warn" | "error";
    message: string;
    detail?: unknown;
  }>;
}