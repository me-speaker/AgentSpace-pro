// FSM L4.2 — Workflow Scheduler
//
// setInterval-driven scheduler that ticks every N ms (default 1000,
// configurable via `SCHEDULER_TICK_MS` env var or `startScheduler({...})`)
// and fires every enabled `ScheduledWorkflow` whose cron pattern is due.
//
// The actual fire calls `handleWorkflowTask` from @agent-space/daemon-test.
// Each fire creates a fresh workflow instance at the definition's
// initialState (handleWorkflowTask's "spawn only" path — no event is
// passed in this L4.2 design).
//
// Cron support: minimal — only "* * * * *" and "*<slash>N * * * *" patterns.
//   "* * * * *"        → fire on every minute change
//   "*<slash>N * * * *" → fire every N minutes (when currentMinute % N === 0)
//
// All other cron patterns throw on registration, so misconfigurations
// surface immediately rather than silently failing.

import { handleWorkflowTask } from "@agent-space/daemon-test";
import {
  type ScheduledWorkflow,
  registerScheduledWorkflow as _register,
  unregisterScheduledWorkflow as _unregister,
  listScheduledWorkflows,
  setLastFiredAt,
  getScheduledWorkflow,
  clearScheduledWorkflows,
} from "./scheduled-workflow.ts";

// Re-export registry helpers so consumers can do everything from the
// scheduler module.
export {
  _register as registerScheduledWorkflow,
  _unregister as unregisterScheduledWorkflow,
  listScheduledWorkflows,
  getScheduledWorkflow,
  clearScheduledWorkflows,
};
export type { ScheduledWorkflow };

// ── Cron parser ──────────────────────────────────────────────────────────────

type MinutePattern = "*" | { every: number };

interface ParsedCron {
  minutePattern: MinutePattern;
}

export function parseCronExpr(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: ${expr} (expected 5 fields, got ${parts.length})`,
    );
  }
  const [minute, hour, dom, month, dow] = parts;
  if (hour !== "*" || dom !== "*" || month !== "*" || dow !== "*") {
    throw new Error(
      `Unsupported cron expression: ${expr} — only "* * * * *" and "*<slash>N * * * *" are supported`,
    );
  }
  if (minute === "*") {
    return { minutePattern: "*" };
  }
  const m = minute.match(/^\*\/(\d+)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isNaN(n) || n < 1 || n > 59) {
      throw new Error(
        `Invalid star-slash-N value in cron: ${m[1]} (must be 1-59)`,
      );
    }
    return { minutePattern: { every: n } };
  }
  throw new Error(
    `Unsupported minute pattern: ${minute} (only "*" and "*<slash>N" are supported)`,
  );
}

/**
 * Decide whether a scheduled workflow is due at `now`, given when it
 * last fired. Returns true on the first call (lastFiredAt === null).
 * For "* * * * *", returns true if the current minute differs from
 * lastFiredAt's minute. For "*<slash>N * * * *", returns true if the
 * current minute is a multiple of N AND the current minute differs
 * from lastFiredAt's minute (so we don't double-fire within the same
 * minute).
 */
export function isCronDue(
  parsed: ParsedCron,
  lastFiredAt: string | null,
  now: Date,
): boolean {
  if (lastFiredAt === null) return true;
  const last = new Date(lastFiredAt);
  if (parsed.minutePattern === "*") {
    return (
      last.getMinutes() !== now.getMinutes() ||
      last.getHours() !== now.getHours()
    );
  }
  const every = parsed.minutePattern.every;
  const nowMinute = now.getMinutes();
  if (nowMinute % every !== 0) return false;
  return last.getMinutes() !== nowMinute;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _tickIntervalMs = 1000;

function resolveTickIntervalMs(opts?: { tickIntervalMs?: number }): number {
  if (opts?.tickIntervalMs !== undefined) {
    return opts.tickIntervalMs;
  }
  const envVal = process.env.SCHEDULER_TICK_MS;
  if (envVal) {
    const n = parseInt(envVal, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return _tickIntervalMs;
}

export function startScheduler(opts?: { tickIntervalMs?: number }): void {
  if (_intervalId !== null) return; // idempotent
  _tickIntervalMs = resolveTickIntervalMs(opts);
  _intervalId = setInterval(tick, _tickIntervalMs);
}

export function stopScheduler(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

export function isSchedulerRunning(): boolean {
  return _intervalId !== null;
}

/**
 * Single tick: scan the registry, fire every due workflow. Exported so
 * tests can drive the scheduler deterministically without waiting for
 * a setInterval. `startScheduler()` is just `setInterval(tick, ms)`.
 */
export function tick(): void {
  const now = new Date();
  for (const wf of listScheduledWorkflows()) {
    if (!wf.enabled) continue;
    let parsed: ParsedCron;
    try {
      parsed = parseCronExpr(wf.cronExpr);
    } catch {
      continue; // skip invalid cron (registration should have caught this)
    }
    if (!isCronDue(parsed, wf.lastFiredAt, now)) continue;

    try {
      handleWorkflowTask({
        workspaceId: wf.workspaceId,
        definitionId: wf.definitionId,
        inputJson: wf.inputJson,
      });
      setLastFiredAt(wf.id, now.toISOString());
    } catch (err) {
      // Fire failures should not crash the tick loop. Log + continue.
      console.error(
        `[scheduler] failed to fire workflow ${wf.id} (def=${wf.definitionId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
