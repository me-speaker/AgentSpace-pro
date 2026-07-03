// FSM L4.2 — Scheduler unit tests
//
// Three scenarios:
//   1. Register `* * * * *` workflow → tick 1 time → instance created
//   2. Register disabled workflow → tick 1 time → no instance
//   3. Register 2 workflows → tick 1 time → 2 instances created (parallel)
//
// We use the in-memory SQLite singleton (`:memory:`) which the DB
// layer's `resetDatabaseForTests()` clears between tests. The
// scheduler's in-memory registry is cleared with `clearScheduledWorkflows()`
// in beforeEach so tests don't bleed into each other.
//
// Run with:
//   SCHEDULER_TICK_MS=100 node --experimental-strip-types --test \\
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
  type ScheduledWorkflow,
} from "./scheduler.ts";
import { parseCronExpr, isCronDue } from "./scheduler.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Bonus: cron parser edge cases ───────────────────────────────────────────

test("parseCronExpr: accepts * * * * * and */N * * * *", () => {
  const p1 = parseCronExpr("* * * * *");
  assert.equal(p1.minutePattern, "*");

  const p2 = parseCronExpr("*/2 * * * *");
  assert.deepEqual(p2.minutePattern, { every: 2 });

  const p3 = parseCronExpr("*/30 * * * *");
  assert.deepEqual(p3.minutePattern, { every: 30 });
});

test("parseCronExpr: rejects unsupported patterns", () => {
  assert.throws(() => parseCronExpr("* * *"), /expected 5 fields/);
  assert.throws(
    () => parseCronExpr("0 12 * * *"),
    /only "\* \* \* \* \*" and "\*<slash>N \* \* \* \*" are supported/,
  );
  assert.throws(() => parseCronExpr("5 * * * *"), /Unsupported minute pattern/);
  assert.throws(() => parseCronExpr("*/0 * * * *"), /Invalid/);
  assert.throws(() => parseCronExpr("*/60 * * * *"), /Invalid/);
});

test("isCronDue: first call (lastFiredAt=null) always fires", () => {
  const parsed = parseCronExpr("* * * * *");
  assert.equal(isCronDue(parsed, null, new Date()), true);
});

test("isCronDue: same minute as last fire → does not fire", () => {
  const parsed = parseCronExpr("* * * * *");
  const now = new Date();
  const lastFiredAt = new Date(now.getTime() - 1000).toISOString(); // 1s ago, same minute
  assert.equal(isCronDue(parsed, lastFiredAt, now), false);
});

test("isCronDue: */2 only fires on even minutes", () => {
  const parsed = parseCronExpr("*/2 * * * *");
  // At minute 0 (or any even minute) with no prior fire → fires
  const evenMinute = new Date(2026, 6, 3, 10, 0, 0); // minute 0
  assert.equal(isCronDue(parsed, null, evenMinute), true);

  // Same minute as last fire → no re-fire
  const sameMinute = new Date(2026, 6, 3, 10, 0, 30);
  assert.equal(
    isCronDue(parsed, evenMinute.toISOString(), sameMinute),
    false,
  );
});
