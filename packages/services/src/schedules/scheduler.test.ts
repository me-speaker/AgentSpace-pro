// FSM P2-1 — Scheduler unit tests (full 5-field cron)
//
// L4.2 scenarios:
//   1. Register `* * * * *` workflow → tick 1 time → instance created
//   2. Register disabled workflow → tick 1 time → no instance
//   3. Register 2 workflows → tick 1 time → 2 instances created (parallel)
//
// P2-1 additions: full cron parser coverage (wildcards, exact, range,
// step, list) and isCronDue semantics across field resolutions
// (minute, hour, day, month, day-of-week).
//
// We use the in-memory SQLite singleton (`:memory:`) which the DB
// layer's `resetDatabaseForTests()` clears between tests. The
// scheduler's in-memory registry is cleared with `clearScheduledWorkflows()`
// in beforeEach so tests don't bleed into each other.
//
// Run with:
//   SCHEDULER_TICK_MS=100 node --experimental-strip-types --test \
//       packages/services/src/schedules/scheduler.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  resetDatabaseForTests,
  getDatabase,
  listWorkflowInstancesForWorkspaceSync,
} from "@agent-space/db";
import {
  startScheduler,
  stopScheduler,
  registerScheduledWorkflow,
  clearScheduledWorkflows,
  tick,
  parseCronExpr,
  isCronDue,
  type ScheduledWorkflow,
} from "./scheduler.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

function seedDefinition(
  workspaceId: string,
  name: string,
  def: object,
): string {
  const db = getDatabase();
  const id = `wfd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const defWithId = { id: name, version: "1.0.0", label: name, ...def };
  db.prepare(
    `INSERT INTO agent_workflow_definition (id, workspace_id, name, version, definition_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, name, 1, JSON.stringify(defWithId), now, now);
  return id;
}

const SIMPLE_DEF = {
  initialState: "idle",
  states: { idle: { id: "idle", label: "Idle" } },
  transitions: {},
};

test.beforeEach(() => {
  resetDatabaseForTests();
  clearScheduledWorkflows();
});

test.after(() => {
  stopScheduler();
  clearScheduledWorkflows();
});

// ── Test 1: enabled + tick ───────────────────────────────────────────────────

test("Register * * * * * workflow → tick 1 time → instance created", () => {
  const defId = seedDefinition("ws_sched1", "simple", SIMPLE_DEF);

  const wf: ScheduledWorkflow = {
    id: "sw1",
    workspaceId: "ws_sched1",
    definitionId: defId,
    cronExpr: "* * * * *",
    enabled: true,
    inputJson: { foo: "bar" },
    lastFiredAt: null,
  };
  registerScheduledWorkflow(wf);

  tick();

  const instances = listWorkflowInstancesForWorkspaceSync("ws_sched1");
  assert.equal(instances.length, 1, "one instance created");
  assert.equal(instances[0].currentState, "idle");
  assert.deepEqual(
    instances[0].contextJson,
    { foo: "bar" },
    "inputJson flows into the new instance's context",
  );
});

// ── Test 2: disabled → no fire ───────────────────────────────────────────────

test("Register disabled workflow → tick 1 time → no instance", () => {
  const defId = seedDefinition("ws_sched2", "disabled", SIMPLE_DEF);

  const wf: ScheduledWorkflow = {
    id: "sw1",
    workspaceId: "ws_sched2",
    definitionId: defId,
    cronExpr: "* * * * *",
    enabled: false,
    inputJson: {},
    lastFiredAt: null,
  };
  registerScheduledWorkflow(wf);

  tick();

  const instances = listWorkflowInstancesForWorkspaceSync("ws_sched2");
  assert.equal(instances.length, 0, "disabled workflow does not fire");
});

// ── Test 3: two workflows fire in parallel ──────────────────────────────────

test("Register 2 enabled workflows → tick 1 time → 2 instances created", () => {
  const defId1 = seedDefinition("ws_sched3", "wf1", SIMPLE_DEF);
  const defId2 = seedDefinition("ws_sched3", "wf2", SIMPLE_DEF);

  registerScheduledWorkflow({
    id: "sw1",
    workspaceId: "ws_sched3",
    definitionId: defId1,
    cronExpr: "* * * * *",
    enabled: true,
    inputJson: { source: "sw1" },
    lastFiredAt: null,
  });
  registerScheduledWorkflow({
    id: "sw2",
    workspaceId: "ws_sched3",
    definitionId: defId2,
    cronExpr: "* * * * *",
    enabled: true,
    inputJson: { source: "sw2" },
    lastFiredAt: null,
  });

  tick();

  const instances = listWorkflowInstancesForWorkspaceSync("ws_sched3");
  assert.equal(instances.length, 2, "both workflows fired in one tick");

  // Each instance carries its own inputJson.
  const sources = instances.map((i) => (i.contextJson as { source?: string }).source).sort();
  assert.deepEqual(sources, ["sw1", "sw2"]);
});

// ── Bonus: startScheduler / stopScheduler lifecycle ─────────────────────────

test("startScheduler / stopScheduler lifecycle: scheduler ticks repeatedly", async () => {
  const defId = seedDefinition("ws_sched4", "lifecycle", SIMPLE_DEF);

  registerScheduledWorkflow({
    id: "sw_lc",
    workspaceId: "ws_sched4",
    definitionId: defId,
    cronExpr: "* * * * *",
    enabled: true,
    inputJson: { tick: 1 },
    lastFiredAt: null,
  });

  // Use a 50ms tick to fire fast (1st fire: lastFiredAt is null).
  startScheduler({ tickIntervalMs: 50 });
  try {
    // Wait > 1 tick. First tick fires the workflow (no lastFiredAt).
    // Subsequent ticks within the same minute skip (cron math).
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    stopScheduler();
  }

  const instances = listWorkflowInstancesForWorkspaceSync("ws_sched4");
  assert.equal(instances.length, 1, "scheduler fired the workflow on first tick");
  assert.equal(instances[0].currentState, "idle");
});

// ── L4.2 minimal parser tests (updated to new API) ─────────────────────────

test("parseCronExpr: accepts * * * * * (all wildcards → all: true fields)", () => {
  const p = parseCronExpr("* * * * *");
  assert.deepEqual(p.minute, { all: true });
  assert.deepEqual(p.hour, { all: true });
  assert.deepEqual(p.dayOfMonth, { all: true });
  assert.deepEqual(p.month, { all: true });
  assert.deepEqual(p.dayOfWeek, { all: true });
});

test("parseCronExpr: */N expands to step value set", () => {
  const p = parseCronExpr("*/15 * * * *");
  assert.equal(p.minute.all, undefined);
  assert.deepEqual(
    Array.from((p.minute as { values: Set<number> }).values).sort((a, b) => a - b),
    [0, 15, 30, 45],
  );
});

// ── P2-1: full cron parser coverage ────────────────────────────────────────

test("parseCronExpr: exact-value fields (N)", () => {
  const p = parseCronExpr("30 14 * * *");
  assert.deepEqual(
    Array.from((p.minute as { values: Set<number> }).values),
    [30],
  );
  assert.deepEqual(
    Array.from((p.hour as { values: Set<number> }).values),
    [14],
  );
  assert.deepEqual(p.dayOfMonth, { all: true });
});

test("parseCronExpr: range fields (N-M)", () => {
  const p = parseCronExpr("* 9-17 * * *");
  assert.equal(p.minute.all, true);
  assert.deepEqual(
    Array.from((p.hour as { values: Set<number> }).values).sort((a, b) => a - b),
    [9, 10, 11, 12, 13, 14, 15, 16, 17],
  );
});

test("parseCronExpr: day-of-week range for weekdays (1-5)", () => {
  const p = parseCronExpr("0 9 * * 1-5");
  assert.deepEqual(
    Array.from((p.dayOfWeek as { values: Set<number> }).values).sort(
      (a, b) => a - b,
    ),
    [1, 2, 3, 4, 5],
  );
});

test("parseCronExpr: list field (N,M,K)", () => {
  const p = parseCronExpr("0,15,30,45 * * * *");
  assert.deepEqual(
    Array.from((p.minute as { values: Set<number> }).values).sort(
      (a, b) => a - b,
    ),
    [0, 15, 30, 45],
  );
});

test("parseCronExpr: list mixed with range (1-5,10,15-20)", () => {
  const p = parseCronExpr("1-5,10,15-20 * * * *");
  assert.deepEqual(
    Array.from((p.minute as { values: Set<number> }).values).sort(
      (a, b) => a - b,
    ),
    [1, 2, 3, 4, 5, 10, 15, 16, 17, 18, 19, 20],
  );
});

test("parseCronExpr: step with range (0-30/5)", () => {
  const p = parseCronExpr("0-30/5 * * * *");
  assert.deepEqual(
    Array.from((p.minute as { values: Set<number> }).values).sort(
      (a, b) => a - b,
    ),
    [0, 5, 10, 15, 20, 25, 30],
  );
});

test("parseCronExpr: rejects non-5-field expressions", () => {
  assert.throws(() => parseCronExpr("* * *"), /expected 5 fields/);
  assert.throws(() => parseCronExpr("* * * * * *"), /expected 5 fields/);
});

test("parseCronExpr: rejects out-of-range values", () => {
  assert.throws(
    () => parseCronExpr("60 * * * *"),
    /Value "60" out of bounds/,
  );
  assert.throws(
    () => parseCronExpr("* 24 * * *"),
    /Value "24" out of bounds/,
  );
  assert.throws(
    () => parseCronExpr("* * 0 * *"),
    /Value "0" out of bounds/,
  );
  assert.throws(
    () => parseCronExpr("* * * 13 *"),
    /Value "13" out of bounds/,
  );
  assert.throws(
    () => parseCronExpr("* * * * 7"),
    /Value "7" out of bounds/,
  );
});

test("parseCronExpr: rejects reversed range", () => {
  assert.throws(
    () => parseCronExpr("5-3 * * * *"),
    /Reversed range "5-3"/,
  );
});

test("parseCronExpr: rejects step=0", () => {
  assert.throws(() => parseCronExpr("*/0 * * * *"), /must be >= 1/);
});

test("parseCronExpr: rejects step without * or N-M range", () => {
  assert.throws(
    () => parseCronExpr("5/2 * * * *"),
    /must use "\*" or "N-M" form/,
  );
});

test("parseCronExpr: rejects empty list item", () => {
  assert.throws(() => parseCronExpr(",5 * * * *"), /Empty list item/);
});

// ── P2-1: isCronDue semantics across field resolutions ─────────────────────

test("isCronDue: first call (lastFiredAt=null) always fires", () => {
  const parsed = parseCronExpr("* * * * *");
  assert.equal(isCronDue(parsed, null, new Date()), true);
});

test("isCronDue: same minute as last fire → does not fire (every-minute)", () => {
  const parsed = parseCronExpr("* * * * *");
  // Use fixed timestamps so this test doesn't race against a minute
  // boundary (which made it flaky under slow test runners like
  // --experimental-test-coverage). last at 14:30:05, now at 14:30:15
  // — same minute, same hour, same day → no re-fire.
  const now = new Date(2026, 6, 10, 14, 30, 15);
  const lastFiredAt = new Date(2026, 6, 10, 14, 30, 5).toISOString();
  assert.equal(isCronDue(parsed, lastFiredAt, now), false);
});

test("isCronDue: */2 fires on multiple-of-2 minutes with no prior fire", () => {
  const parsed = parseCronExpr("*/2 * * * *");
  const evenMinute = new Date(2026, 6, 3, 10, 0, 0);
  assert.equal(isCronDue(parsed, null, evenMinute), true);

  const sameMinute = new Date(2026, 6, 3, 10, 0, 30);
  assert.equal(
    isCronDue(parsed, evenMinute.toISOString(), sameMinute),
    false,
  );
});

test("isCronDue: hourly cron (0 * * * *) fires when hour changes", () => {
  const parsed = parseCronExpr("0 * * * *");
  const last = new Date(2026, 6, 3, 14, 30, 0);
  const next = new Date(2026, 6, 3, 15, 0, 0);
  assert.equal(isCronDue(parsed, last.toISOString(), next), true);

  // Wrong minute → not cron match
  const wrongMin = new Date(2026, 6, 3, 15, 30, 0);
  assert.equal(isCronDue(parsed, last.toISOString(), wrongMin), false);

  // Hour changed, minute matches → fire
  const sameMinDiffHr = new Date(2026, 6, 3, 15, 0, 0);
  assert.equal(
    isCronDue(
      parsed,
      new Date(2026, 6, 3, 14, 0, 0).toISOString(),
      sameMinDiffHr,
    ),
    true,
  );
});

test("isCronDue: daily-at-specific-time cron (30 14 * * *) advances across days", () => {
  const parsed = parseCronExpr("30 14 * * *");
  const yesterday = new Date(2026, 6, 3, 14, 30, 0);
  const today = new Date(2026, 6, 4, 14, 30, 0);
  assert.equal(isCronDue(parsed, yesterday.toISOString(), today), true);

  // Same day, same minute → don't fire
  const sameDay = new Date(2026, 6, 3, 14, 30, 30);
  assert.equal(isCronDue(parsed, yesterday.toISOString(), sameDay), false);

  // Right time but wrong hour → not cron match
  const wrongHour = new Date(2026, 6, 4, 13, 30, 0);
  assert.equal(isCronDue(parsed, yesterday.toISOString(), wrongHour), false);
});

test("isCronDue: weekday cron (0 9 * * 1-5) fires only on weekdays", () => {
  const parsed = parseCronExpr("0 9 * * 1-5");
  const lastMon = new Date(2026, 6, 6, 9, 0, 0);

  // Tue 09:00 → fire (dow=2 in 1-5, hour=9, minute=0, day changed)
  const tue = new Date(2026, 6, 7, 9, 0, 0);
  assert.equal(isCronDue(parsed, lastMon.toISOString(), tue), true);

  // Sat 09:00 → don't fire (dow=6 NOT in 1-5)
  const sat = new Date(2026, 6, 11, 9, 0, 0);
  assert.equal(isCronDue(parsed, lastMon.toISOString(), sat), false);
});

test("isCronDue: monthly-first-day cron (0 0 1 * *) advances across months", () => {
  const parsed = parseCronExpr("0 0 1 * *");
  const jun1 = new Date(2026, 5, 1, 0, 0, 0);
  const jul1 = new Date(2026, 6, 1, 0, 0, 0);
  assert.equal(isCronDue(parsed, jun1.toISOString(), jul1), true);

  const sameMin = new Date(2026, 5, 1, 0, 0, 30);
  assert.equal(isCronDue(parsed, jun1.toISOString(), sameMin), false);
});

// ── P2-1: integration smoke (real cron pattern, real tick) ────────────────

test("P2-1 integration: schedule */5 14 * * * cron fires via tick", () => {
  const defId = seedDefinition("ws_p21", "p21-test", SIMPLE_DEF);
  registerScheduledWorkflow({
    id: "sw_p21",
    workspaceId: "ws_p21",
    definitionId: defId,
    cronExpr: "*/5 14 * * *",
    enabled: true,
    inputJson: { tag: "p21-smoke" },
    lastFiredAt: null,
  });

  tick();

  const instances = listWorkflowInstancesForWorkspaceSync("ws_p21");
  assert.equal(instances.length, 1, "tick fires schedule (lastFiredAt null)");
  assert.equal(instances[0].currentState, "idle");
  assert.deepEqual(instances[0].contextJson, { tag: "p21-smoke" });
});
