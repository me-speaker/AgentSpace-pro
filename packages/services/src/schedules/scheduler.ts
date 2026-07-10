// FSM P2-1 — Workflow Scheduler (full 5-field cron)
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
// Cron support: full 5-field expressions. Each field accepts:
//   "*"          wildcard (matches every value in range)
//   "N"          exact value (e.g. "5")
//   "N-M"        range (inclusive, e.g. "1-5")
//   "*/N"        step from min to max (e.g. "*/15" on minute = 0,15,30,45)
//   "N,M,K,..."  list (e.g. "1,3,5")
// Fields:
//   minute        0-59
//   hour          0-23
//   day-of-month  1-31
//   month         1-12
//   day-of-week   0-6 (Sunday = 0)
//
// Examples:
//   "* * * * *"           every minute
//   "*/15 * * * *"        every 15 minutes
//   "30 14 * * *"         every day at 14:30
//   "0 9 * * 1-5"         Mon-Fri at 09:00
//   "0,15,30,45 * * * *"  every quarter-hour (explicit list)
//   "0 0 1 * *"           first day of each month at 00:00
//
// All non-`*` field values must be in their natural range; reversed ranges
// ("5-3"), out-of-range values, step=0, and missing fields all throw so
// misconfigurations surface immediately at registration.

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

// ── Cron types & parser ────────────────────────────────────────────

/**
 * Per-field representation. `all: true` means "*" (every value matches).
 * `values` is the pre-expanded set of allowed values for that field —
 * set construction happens once at parse time, not on every due-check.
 */
export type CronField = { all: true } | { values: Set<number> };

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/** Field bounds, indexed by position in the cron expression. */
const FIELD_BOUNDS: ReadonlyArray<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 6 },
];

/**
 * Parse a 5-field cron expression. Supports the full POSIX-ish syntax
 * documented at the top of the file. Throws on any structural problem;
 * the scheduler hooks catch and skip, so a bad cron never crashes the
 * tick loop, but `registerScheduledWorkflow` callers should treat a
 * throw as a registration failure.
 */
export function parseCronExpr(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: ${JSON.stringify(expr)} (expected 5 fields, got ${parts.length})`,
    );
  }
  return {
    minute: parseField(parts[0], FIELD_BOUNDS[0]),
    hour: parseField(parts[1], FIELD_BOUNDS[1]),
    dayOfMonth: parseField(parts[2], FIELD_BOUNDS[2]),
    month: parseField(parts[3], FIELD_BOUNDS[3]),
    dayOfWeek: parseField(parts[4], FIELD_BOUNDS[4]),
  };
}

function parseField(
  token: string,
  bounds: { name: string; min: number; max: number },
): CronField {
  if (token === "*") return { all: true };
  const values = new Set<number>();
  for (const part of token.split(",")) {
    if (part === "") {
      throw new Error(
        `Empty list item in ${bounds.name} token: ${JSON.stringify(token)}`,
      );
    }
    if (part.includes("/")) {
      addStep(values, part, bounds);
    } else if (part.includes("-")) {
      addRange(values, part, bounds);
    } else {
      const n = parseInt(part, 10);
      if (Number.isNaN(n) || n < bounds.min || n > bounds.max) {
        throw new Error(
          `Value ${JSON.stringify(part)} out of bounds [${bounds.min}-${bounds.max}] in ${bounds.name} token: ${JSON.stringify(token)}`,
        );
      }
      values.add(n);
    }
  }
  return { values };
}

function addRange(
  values: Set<number>,
  part: string,
  bounds: { name: string; min: number; max: number },
): void {
  const dashIdx = part.indexOf("-");
  if (dashIdx === -1) {
    throw new Error(`Range "${part}" is missing dash in ${bounds.name}`);
  }
  const sStr = part.slice(0, dashIdx);
  const eStr = part.slice(dashIdx + 1);
  const s = parseInt(sStr, 10);
  const e = parseInt(eStr, 10);
  if (Number.isNaN(s) || Number.isNaN(e)) {
    throw new Error(
      `Invalid range "${part}" in ${bounds.name} (non-numeric bound)`,
    );
  }
  if (s > e) {
    throw new Error(
      `Reversed range "${part}" in ${bounds.name} (start ${s} > end ${e})`,
    );
  }
  if (s < bounds.min || e > bounds.max) {
    throw new Error(
      `Range ${s}-${e} out of bounds [${bounds.min}-${bounds.max}] in ${bounds.name}`,
    );
  }
  for (let i = s; i <= e; i++) values.add(i);
}

function addStep(
  values: Set<number>,
  part: string,
  bounds: { name: string; min: number; max: number },
): void {
  const slashIdx = part.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Step "${part}" is missing slash in ${bounds.name}`);
  }
  const rangeStr = part.slice(0, slashIdx);
  const stepStr = part.slice(slashIdx + 1);
  const step = parseInt(stepStr, 10);
  if (Number.isNaN(step) || step < 1) {
    throw new Error(
      `Invalid step "${stepStr}" in ${bounds.name} (must be >= 1)`,
    );
  }
  let start: number;
  let end: number;
  if (rangeStr === "*") {
    start = bounds.min;
    end = bounds.max;
  } else if (rangeStr.includes("-")) {
    const dashIdx = rangeStr.indexOf("-");
    const s = parseInt(rangeStr.slice(0, dashIdx), 10);
    const e = parseInt(rangeStr.slice(dashIdx + 1), 10);
    if (Number.isNaN(s) || Number.isNaN(e)) {
      throw new Error(
        `Invalid range "${rangeStr}" in step "${part}" in ${bounds.name}`,
      );
    }
    if (s > e) {
      throw new Error(
        `Reversed range "${rangeStr}" in step "${part}" in ${bounds.name} (start ${s} > end ${e})`,
      );
    }
    if (s < bounds.min || e > bounds.max) {
      throw new Error(
        `Range ${s}-${e} out of bounds [${bounds.min}-${bounds.max}] in step "${part}" in ${bounds.name}`,
      );
    }
    start = s;
    end = e;
  } else {
    throw new Error(
      `Step "${part}" must use "*" or "N-M" form, not "${rangeStr}", in ${bounds.name}`,
    );
  }
  for (let i = start; i <= end; i += step) values.add(i);
}

function matchesField(field: CronField, value: number): boolean {
  if (field.all) return true;
  return field.values.has(value);
}

function matchesAllFields(parsed: ParsedCron, d: Date): boolean {
  return (
    matchesField(parsed.minute, d.getMinutes()) &&
    matchesField(parsed.hour, d.getHours()) &&
    matchesField(parsed.dayOfMonth, d.getDate()) &&
    matchesField(parsed.month, d.getMonth() + 1) &&
    matchesField(parsed.dayOfWeek, d.getDay())
  );
}

/**
 * Decide whether a scheduled workflow is due at `now`, given when it
 * last fired. Returns true on the first call (lastFiredAt === null).
 * Otherwise, all 5 fields must match `now` (cron semantics) AND at
 * least one field must have advanced since the last fire (to prevent
 * double-fire when the tick interval is shorter than the cron's
 * minimum resolution).
 */
export function isCronDue(
  parsed: ParsedCron,
  lastFiredAt: string | null,
  now: Date,
): boolean {
  if (lastFiredAt === null) return true;
  const last = new Date(lastFiredAt);
  if (!matchesAllFields(parsed, now)) return false;
  return (
    last.getMinutes() !== now.getMinutes() ||
    last.getHours() !== now.getHours() ||
    last.getDate() !== now.getDate() ||
    last.getMonth() !== now.getMonth() ||
    last.getDay() !== now.getDay()
  );
}

// ── Lifecycle ────────────────────────────────────────────────

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
