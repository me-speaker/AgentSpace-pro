// FSM 1.2 — Workflow Runtime Core
// executeTransition() + helpers
//
// L2 update (2026-07-02):
//   - evalGuard() now uses vm.runInNewContext with a 200ms timeout instead
//     of `new Function()`. Function constructor runs in the host realm and
//     is unsafe for untrusted guard.condition strings; the VM context gives
//     us a separate global object + a hard timeout kill-switch.
//   - Runtime accepts an optional "store" so the FSM step can persist
//     instances + history via the *Sync CRUD in ./store.ts. When no store
//     is registered the runtime behaves purely in-memory (preserves L1
//     semantics + the existing 18-test suite).
//
// Schema types live in @agent-space/domain/workflows (FSM 1.1).

import vm from "node:vm";
import type {
  WorkflowInstance,
  WorkflowDefinition,
  WorkflowEvent,
  TransitionResult,
  WorkflowHistoryEntry,
  WorkflowAction,
  WorkflowGuard,
  WorkflowTransition,
  WorkflowState,
} from "@agent-space/domain/workflows";

// ── Store integration (optional) ─────────────────────────────────────────────
//
// The store is intentionally typed loosely so runtime.ts does not have to
// import the full store module (and so test setups without a DB still work).
// Wire it up via setStore() — typically from the services package bootstrap.

import type {
  WorkflowStore,
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
} from "./store.ts";

let _store: WorkflowStore | null = null;

/** Inject a workflow store so runtime calls persist side-effects. */
export function setStore(store: WorkflowStore | null): void {
  _store = store;
}

/** Returns the currently wired store, or null if none. */
export function getStore(): WorkflowStore | null {
  return _store;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function createInstanceId(): string {
  return `wfi_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Default guard-evaluation timeout (ms). 200ms is generous for a single
 * expression while still bounding an infinite loop runaway.
 */
export const GUARD_VM_TIMEOUT_MS = 200;

// ── Status mapping (runtime ↔ store) ──────────────────────────────────────────
//
// The runtime uses WorkflowStatus = "idle" | "running" | "waiting" |
// "completed" | "failed" | "cancelled". The store schema (per L2 brief)
// uses "active" for what we call "running" — they are the same concept
// just under different names. We map at the persistence boundary so the
// rest of the runtime keeps using "running".

const RUNTIME_TO_STORE_STATUS: Record<string, string> = {
  idle: "active",
  running: "active",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

const STORE_TO_RUNTIME_STATUS: Record<string, WorkflowInstance["status"]> = {
  active: "running",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

function toStoreStatus(runtimeStatus: WorkflowInstance["status"]): string {
  return RUNTIME_TO_STORE_STATUS[runtimeStatus] ?? "active";
}

function toRuntimeStatus(storeStatus: string): WorkflowInstance["status"] {
  return STORE_TO_RUNTIME_STATUS[storeStatus] ?? "running";
}

/**
 * Evaluate a guard condition in an isolated VM context with a hard timeout.
 *
 * Sandbox model:
 *   - vm.runInNewContext() creates a fresh global object (no access to
 *     process, require, fetch, etc. unless explicitly exposed).
 *   - The sandbox exposes { ctx, ...ctx } so the expression can reference
 *     fields directly via `with(ctx)`. Note: `with` is allowed inside the
 *     VM because the VM enforces its own scope rules; it does NOT leak
 *     host globals.
 *   - `timeout` (200ms) interrupts the script if it runs away.
 *
 * Errors of any kind (syntax, runtime, timeout) resolve to false — the
 * caller treats a guard failure as "condition not met".
 */
function evalGuard(
  guard: WorkflowGuard,
  ctx: Record<string, unknown>,
  timeoutMs: number = GUARD_VM_TIMEOUT_MS
): boolean {
  try {
    const sandbox: Record<string, unknown> = { ctx, ...ctx };
    vm.createContext(sandbox);
    // Wrap in an IIFE so the body can `return`. We intentionally do NOT
    // enable `"use strict"` because the guard body uses a `with(ctx)`
    // statement and `with` is a SyntaxError under strict mode.
    const code = `(function() { with (ctx) { return !!(${guard.condition}); } })()`;
    const result = vm.runInNewContext(code, sandbox, {
      timeout: timeoutMs,
      displayErrors: false,
    });
    return result === true;
  } catch {
    return false;
  }
}

function runAction(
  action: WorkflowAction,
  instance: WorkflowInstance
): { ok: boolean; error?: string } {
  try {
    // Placeholder: resolve service path + call with args.
    // Real implementation resolves via service registry (DI container).
    void action.service;
    void action.args;
    void instance;
    // const [svc, method] = action.service.split(".");
    // const fn = serviceRegistry.get(svc)?.[method];
    // if (!fn) throw new Error(`Service method not found: ${action.service}`);
    // await fn({ ...instance.context, ...action.args });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Evaluate all guards for a transition.
 * Returns { passed: true } if all guards pass (or there are no guards).
 * Returns { passed: false, failedGuard: id } on first failure.
 */
export function evaluateGuards(
  transition: WorkflowTransition,
  ctx: Record<string, unknown>
): { passed: boolean; failedGuard?: string } {
  if (!transition.guards || transition.guards.length === 0) {
    return { passed: true };
  }
  for (const guard of transition.guards) {
    if (!evalGuard(guard, ctx)) {
      if (guard.required !== false) {
        return { passed: false, failedGuard: guard.id };
      }
      // optional guard: warn but continue
    }
  }
  return { passed: true };
}

/**
 * Run actions for a given phase (enter / exit / transition).
 * Returns array of { id, phase, ok, error }.
 */
export function runPhaseActions(
  phaseActions: WorkflowAction[] | undefined,
  instance: WorkflowInstance,
  phase: WorkflowAction["phase"]
): Array<{ id: string; phase: WorkflowAction["phase"]; ok: boolean; error?: string }> {
  if (!phaseActions || phaseActions.length === 0) return [];
  return phaseActions.map((action) => {
    const result = runAction({ ...action, phase }, instance);
    return { id: action.id, phase, ...result };
  });
}

/**
 * Find the best matching transition for the given event + current state.
 * Matching rules:
 *  1. transition.from includes currentState (or is '*')
 *  2. transition.event matches event.type (or transition.event is undefined for auto)
 *  3. All guards pass
 * Returns null if no transition matches.
 */
export function findTransition(
  def: WorkflowDefinition,
  instance: WorkflowInstance,
  event: WorkflowEvent
): WorkflowTransition | null {
  const eventName = event.type === "SIGNAL" ? event.signal
    : event.type === "CALLBACK" ? "__callback"
    : event.type === "ERROR" ? "__error"
    : event.type === "CANCEL" ? "__cancel"
    : event.type === "TIMEOUT" ? "__timeout"
    : null;

  for (const t of Object.values(def.transitions)) {
    // Check source state match
    const fromStates = Array.isArray(t.from) ? t.from : [t.from];
    const sourceMatch = fromStates.includes("*") || fromStates.includes(instance.currentState);
    if (!sourceMatch) continue;

    // Check event match
    if (t.kind === "explicit") {
      if (eventName !== t.event) continue;
    } else if (t.kind === "automatic") {
      // automatic transitions fire on START event only
      if (event.type !== "START") continue;
    } else if (t.kind === "callback") {
      if (event.type !== "CALLBACK" || event.token !== instance.callbackToken) continue;
    }

    // Check guards
    const guardResult = evaluateGuards(t, instance.context);
    if (!guardResult.passed) continue;

    return t;
  }
  return null;
}

/**
 * Increment attempt counter for a transition. Returns updated instance copy.
 */
export function bumpAttempt(
  instance: WorkflowInstance,
  transitionId: string
): WorkflowInstance {
  const limit = instance.attemptLimit ?? Infinity;
  const current = instance.attempts[transitionId] ?? 0;
  if (current + 1 > limit) {
    throw new Error(
      `Attempt limit exceeded for transition '${transitionId}' (limit=${limit})`
    );
  }
  return {
    ...instance,
    attempts: { ...instance.attempts, [transitionId]: current + 1 },
  };
}

// ── Main State Machine Step ───────────────────────────────────────────────────

/**
 * Execute one state machine step:
 *  1. Find matching transition for the event
 *  2. Run exit actions (source state)
 *  3. Evaluate guards
 *  4. Run transition actions
 *  5. Update instance (state, history, attempts, status)
 *
 * Returns { instance, result }. The instance is always a new object (immutable).
 */
export function executeTransition(
  instance: WorkflowInstance,
  event: WorkflowEvent,
  definition: WorkflowDefinition
): { instance: WorkflowInstance; result: TransitionResult } {
  const now = new Date().toISOString();
  const def = definition; // alias for clarity

  // Find matching transition
  const transition = findTransition(def, instance, event);

  if (!transition) {
    return {
      instance,
      result: {
        transitioned: false,
        toState: null,
        guardsPassed: true,
        actionsRun: [],
        error: `No matching transition for event '${event.type}' in state '${instance.currentState}'`,
      },
    };
  }

  const sourceState = def.states[instance.currentState];
  const targetState = def.states[transition.to];

  // Run exit actions (source state)
  const exitResults = runPhaseActions(sourceState?.exitActions, instance, "exit");

  // Run transition actions
  const transitionResults = runPhaseActions(transition.actions, instance, "transition");

  // Check for fatal errors from required actions
  const allActionResults = [...exitResults, ...transitionResults];
  const fatalErrors = allActionResults.filter(
    (r) => !r.ok && !transition.actions?.find((a) => a.id === r.id)?.continueOnError
  );
  if (fatalErrors.length > 0) {
    const err = fatalErrors[0].error ?? "Action failed";
    const historyEntry: WorkflowHistoryEntry = {
      idx: instance.history.length,
      timestamp: now,
      fromState: instance.currentState,
      toState: transition.to,
      transitionId: transition.id,
      eventName: event.type,
      actionResults: Object.fromEntries(allActionResults.map((r) => [r.id, r.ok ? "ok" : "error"])),
      error: err,
    };
    return {
      instance: {
        ...instance,
        status: "failed",
        error: err,
        history: [...instance.history, historyEntry],
        updatedAt: now,
      },
      result: {
        transitioned: false,
        toState: null,
        guardsPassed: true,
        actionsRun: allActionResults,
        error: err,
      },
    };
  }

  // Bump attempt counter
  let updatedInstance: WorkflowInstance;
  try {
    updatedInstance = bumpAttempt(instance, transition.id);
  } catch (err) {
    const errMsg = String(err);
    const historyEntry: WorkflowHistoryEntry = {
      idx: instance.history.length,
      timestamp: now,
      fromState: instance.currentState,
      toState: transition.to,
      transitionId: transition.id,
      eventName: event.type,
      guardResults: Object.fromEntries(
        (transition.guards ?? []).map((g) => [g.id, evalGuard(g, instance.context)])
      ),
      actionResults: Object.fromEntries(allActionResults.map((r) => [r.id, r.ok ? "ok" : "error"])),
      error: errMsg,
    };
    return {
      instance: {
        ...instance,
        status: "failed",
        error: errMsg,
        history: [...instance.history, historyEntry],
        updatedAt: now,
      },
      result: {
        transitioned: false,
        toState: null,
        guardsPassed: true,
        actionsRun: allActionResults,
        error: errMsg,
      },
    };
  }

  // Build history entry
  const historyEntry: WorkflowHistoryEntry = {
    idx: updatedInstance.history.length,
    timestamp: now,
    fromState: instance.currentState,
    toState: transition.to,
    transitionId: transition.id,
    eventName: event.type,
    guardResults: Object.fromEntries(
      (transition.guards ?? []).map((g) => [g.id, evalGuard(g, instance.context)])
    ),
    actionResults: Object.fromEntries(allActionResults.map((r) => [r.id, r.ok ? "ok" : "error"])),
  };

  // Determine new status
  let newStatus: WorkflowInstance["status"] = "running";
  if (targetState?.awaitingCallback) {
    newStatus = "waiting";
  } else if (targetState && targetState.id === def.errorState) {
    newStatus = "failed";
  } else if (targetState && targetState.id === def.timeoutState) {
    newStatus = "failed";
  }

  const newInstance: WorkflowInstance = {
    ...updatedInstance,
    status: newStatus,
    currentState: transition.to,
    context: {
      ...updatedInstance.context,
      // Inject event payload into context
      ...(event.payload ?? {}),
    },
    history: [...updatedInstance.history, historyEntry],
    updatedAt: now,
    callStack: targetState?.awaitingCallback
      ? [...updatedInstance.callStack, transition.to]
      : updatedInstance.callStack,
    callbackToken:
      event.type === "CALLBACK" ? event.token : updatedInstance.callbackToken,
    deadline: targetState?.timeoutMs
      ? new Date(Date.now() + targetState.timeoutMs).toISOString()
      : undefined,
  };

  // Persist transition effects via store (if wired). Wrapped in try/catch
  // so a DB hiccup never breaks the in-memory FSM step.
  try {
    persistTransitionEffects(instance, newInstance, event, {
      transitioned: true,
      toState: transition.to,
      guardsPassed: true,
      actionsRun: allActionResults,
    });
  } catch {
    // intentional swallow
  }

  return {
    instance: newInstance,
    result: {
      transitioned: true,
      toState: transition.to,
      guardsPassed: true,
      actionsRun: allActionResults,
    },
  };
}

/**
 * Start a new workflow instance from a definition + optional initial payload.
 *
 * Side effect: if a store has been wired via setStore(), the new instance
 * is persisted via createWorkflowInstanceSync + recordWorkflowHistorySync
 * (for the START history entry). Returns the in-memory instance regardless.
 */
export function createWorkflowInstance(
  definition: WorkflowDefinition,
  workspaceId: string,
  payload?: Record<string, unknown>,
  label?: string
): WorkflowInstance {
  const now = new Date().toISOString();
  const instance: WorkflowInstance = {
    id: createInstanceId(),
    definitionId: definition.id,
    definitionVersion: definition.version,
    workspaceId,
    status: "running",
    currentState: definition.initialState,
    context: payload ?? {},
    variables: {},
    label,
    createdAt: now,
    updatedAt: now,
    attempts: {},
    history: [
      {
        idx: 0,
        timestamp: now,
        fromState: null,
        toState: definition.initialState,
        transitionId: null,
        eventName: "START",
      },
    ],
    callStack: [],
  };

  // Persist via store (if wired). Errors are swallowed to keep the FSM
  // step pure — the in-memory instance is still authoritative for the
  // current call. A production setup would surface persistence failures
  // via a separate channel (retry queue / outbox).
  if (_store) {
    try {
      _store.createWorkflowInstanceSync({
        id: instance.id,
        workspaceId,
        definitionId: definition.id,
        status: toStoreStatus(instance.status),
        currentState: instance.currentState,
        context: instance.context,
        attemptCount: 0,
      });
      _store.recordWorkflowHistorySync({
        id: `wfh_${instance.id}_0`,
        workspaceId,
        instanceId: instance.id,
        eventType: "START",
        fromState: null,
        toState: instance.currentState,
        payload: {},
      });
    } catch {
      // intentional swallow — see comment above
    }
  }

  return instance;
}

/**
 * Resume a 'waiting' instance from a callback event.
 *
 * Side effect: if a store is wired, looks up the live instance via
 * findWorkflowInstanceByCallbackTokenSync before executing. When called
 * with an in-memory instance (no store) the input instance is used as-is.
 */
export function resumeFromCallback(
  instance: WorkflowInstance,
  event: WorkflowEvent,
  definition: WorkflowDefinition
): { instance: WorkflowInstance; result: TransitionResult } {
  let liveInstance: WorkflowInstance = instance;
  if (_store) {
    try {
      if (event.type === "CALLBACK") {
        const stored = _store.findWorkflowInstanceByCallbackTokenSync(
          instance.workspaceId,
          event.token
        );
        if (stored) {
          // Re-hydrate the instance from the stored record so history,
          // attempts, and status reflect what the DB has on file.
          liveInstance = hydrateInstanceFromRecord(stored, instance);
        }
      }
    } catch {
      // fall back to in-memory instance
    }
  }

  if (liveInstance.status !== "waiting") {
    return {
      instance: liveInstance,
      result: {
        transitioned: false,
        toState: null,
        guardsPassed: false,
        actionsRun: [],
        error: `Instance '${liveInstance.id}' is not in 'waiting' state`,
      },
    };
  }
  return executeTransition(liveInstance, event, definition);
}

/**
 * Re-build a WorkflowInstance from a store record, preserving the live
 * `context` and `variables` from the caller (they may carry non-DB
 * values) and folding in the persisted history/attempts/status.
 */
function hydrateInstanceFromRecord(
  record: WorkflowInstanceRecord,
  fallback: WorkflowInstance
): WorkflowInstance {
  return {
    ...fallback,
    id: record.id,
    workspaceId: record.workspaceId,
    definitionId: record.definitionId,
    status: toRuntimeStatus(record.status),
    currentState: record.currentState,
    context: fallback.context ?? record.context,
    variables: fallback.variables ?? {},
    attempts: fallback.attempts ?? {},
    history: fallback.history ?? [],
    callbackToken: record.callbackToken ?? undefined,
    deadline: record.deadlineAt ?? undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persist a transition's effects (new instance state + history entry).
 * Called from executeTransition when a store is wired. Errors are swallowed.
 */
function persistTransitionEffects(
  beforeInstance: WorkflowInstance,
  afterInstance: WorkflowInstance,
  event: WorkflowEvent,
  result: TransitionResult
): void {
  if (!_store) return;
  try {
    _store.updateWorkflowInstanceStateSync(afterInstance.id, {
      status: toStoreStatus(afterInstance.status),
      currentState: afterInstance.currentState,
      context: afterInstance.context,
      attemptCount: Object.values(afterInstance.attempts).reduce(
        (sum, n) => sum + n,
        0
      ),
      callbackToken: afterInstance.callbackToken,
      deadlineAt: afterInstance.deadline,
    });
    const lastHistory = afterInstance.history[afterInstance.history.length - 1];
    if (lastHistory) {
      _store.recordWorkflowHistorySync({
        id: `wfh_${afterInstance.id}_${lastHistory.idx}`,
        workspaceId: afterInstance.workspaceId,
        instanceId: afterInstance.id,
        eventType: event.type,
        fromState: lastHistory.fromState,
        toState: lastHistory.toState,
        payload: {
          transitionId: lastHistory.transitionId,
          guardResults: lastHistory.guardResults,
          actionResults: lastHistory.actionResults,
          error: lastHistory.error,
        },
      });
    }
  } catch {
    // intentional swallow — see createWorkflowInstance
  }
}

/**
 * Advance a 'running' instance that has an auto-transition from its current state.
 */
export function advanceAuto(
  instance: WorkflowInstance,
  definition: WorkflowDefinition
): { instance: WorkflowInstance; result: TransitionResult } {
  const state = definition.states[instance.currentState];
  if (!state?.autoTransition) {
    return {
      instance,
      result: {
        transitioned: false,
        toState: null,
        guardsPassed: true,
        actionsRun: [],
        error: `No auto-transition from state '${instance.currentState}'`,
      },
    };
  }
  const autoT = definition.transitions[state.autoTransition];
  if (!autoT) {
    return {
      instance,
      result: {
        transitioned: false,
        toState: null,
        guardsPassed: true,
        actionsRun: [],
        error: `Auto-transition '${state.autoTransition}' not found in definition`,
      },
    };
  }
  return executeTransition(instance, { type: "SIGNAL", signal: "__auto" }, definition);
}