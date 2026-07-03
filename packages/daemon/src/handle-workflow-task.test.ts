// FSM L4.1 — handleWorkflowTask unit tests
//
// Three scenarios:
//   1. happy path: definition with 1 transition, fire event, instance
//      advances, history has 2 records (START recorded by create + the
//      SIGNAL recorded by executeTransition).
//   2. guard denied: definition with a guard, guard fails, instance
//      stays at initial state, history records a `guard_fail` event.
//   3. workspace isolation: workspace A's definition/instance cannot
//      be touched from workspace B.
//
// We use the in-memory SQLite singleton (`:memory:`) which the DB
// layer's `resetDatabaseForTests()` clears between tests.
//
// Run with:
//   node --experimental-strip-types --test packages/daemon/src/handle-workflow-task.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  resetDatabaseForTests,
  getDatabase,
  readWorkflowInstanceSync,
  listWorkflowInstancesForWorkspaceSync,
  type WorkflowInstanceRecord,
} from "@agent-space/db";
import { handleWorkflowTask } from "./handle-workflow-task.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface DefinitionFixture {
  initialState: string;
  states: Record<string, { id: string; label: string; awaitingCallback?: boolean }>;
  transitions: Record<string, unknown>;
}

function seedDefinition(
  workspaceId: string,
  name: string,
  definition: DefinitionFixture,
): string {
  const db = getDatabase();
  const id = `wfd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const defWithId = {
    id: name,
    version: "1.0.0",
    label: name,
    ...definition,
  };
  db.prepare(
    `INSERT INTO agent_workflow_definition (id, workspace_id, name, version, definition_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, name, 1, JSON.stringify(defWithId), now, now);
  return id;
}

function getHistory(instanceId: string): Array<{ event_type: string; from_state: string | null; to_state: string | null }> {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT event_type, from_state, to_state FROM agent_workflow_history
       WHERE instance_id = ? ORDER BY created_at ASC`,
    )
    .all(instanceId) as Array<{ event_type: string; from_state: string | null; to_state: string | null }>;
}

test.beforeEach(() => {
  resetDatabaseForTests();
});

// ── Test 1: Happy path ───────────────────────────────────────────────────────

test("happy path: definition with 1 transition, fire event, instance advances, history has 2 records", () => {
  const WS = "ws_happy";
  const defId = seedDefinition(WS, "one-transition", {
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      running: { id: "running", label: "Running" },
    },
    transitions: {
      t1: { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start" },
    },
  });

  const result = handleWorkflowTask({
    workspaceId: WS,
    definitionId: defId,
    event: { type: "SIGNAL", signal: "start" },
  });

  // The handleWorkflowTask created a new instance at idle, recorded a
  // START history (during instance creation), and then ran the SIGNAL
  // transition that recorded a 2nd history row.
  assert.ok(result.instanceId.startsWith("wfi_"), "instance id has wfi_ prefix");
  assert.equal(result.currentState, "running");
  // "running" has no outgoing transitions in this fixture, so the
  // daemon's isTerminalState() check promotes the DB status to
  // "completed" — this is the same check that makes L4.5 step 6's
  // "done" state reach status="completed".
  assert.equal(result.status, "completed", "terminal state promoted to completed");
  assert.equal(result.transitioned, true);
  assert.equal(result.historyCount, 2, "START + SIGNAL history rows");

  // Re-read from DB to confirm the row was actually persisted.
  const stored = readWorkflowInstanceSync(result.instanceId);
  assert.ok(stored, "instance row exists in DB");
  assert.equal(stored?.currentState, "running");
  assert.equal(stored?.status, "completed");

  // Confirm both history rows in correct order: START then SIGNAL.
  const hist = getHistory(result.instanceId);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].event_type, "START");
  assert.equal(hist[0].from_state, null);
  assert.equal(hist[0].to_state, "idle");
  assert.equal(hist[1].event_type, "start");
  assert.equal(hist[1].from_state, "idle");
  assert.equal(hist[1].to_state, "running");
});

// ── Test 2: Guard denied ─────────────────────────────────────────────────────

test("guard denied: required guard fails, instance stays, history records guard_fail", () => {
  const WS = "ws_guard";
  const defId = seedDefinition(WS, "guarded", {
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      running: { id: "running", label: "Running" },
    },
    transitions: {
      t1: {
        id: "t1",
        from: "idle",
        to: "running",
        kind: "explicit",
        event: "start",
        guards: [
          {
            id: "g1",
            label: "must be ready",
            condition: "ctx.ready === true",
            required: true,
          },
        ],
      },
    },
  });

  // inputJson sets ready=false, so the guard `ctx.ready === true` fails.
  const result = handleWorkflowTask({
    workspaceId: WS,
    definitionId: defId,
    inputJson: { ready: false },
    event: { type: "SIGNAL", signal: "start" },
  });

  // Instance stays at idle (transition was blocked by the guard).
  assert.equal(result.currentState, "idle");
  assert.equal(result.status, "active");
  assert.equal(result.transitioned, false);
  // START (from create) + guard_fail (from blocked event) = 2 rows.
  assert.equal(result.historyCount, 2);

  // The stored instance still has the initial context.
  const stored = readWorkflowInstanceSync(result.instanceId);
  assert.equal(stored?.currentState, "idle");
  assert.deepEqual(stored?.contextJson, { ready: false });

  // The history contains START then guard_fail.
  const hist = getHistory(result.instanceId);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].event_type, "START");
  assert.equal(hist[0].from_state, null);
  assert.equal(hist[0].to_state, "idle");
  assert.equal(hist[1].event_type, "guard_fail");
  assert.equal(hist[1].from_state, "idle");
  assert.equal(hist[1].to_state, null);
});

// ── Test 3: Workspace isolation ──────────────────────────────────────────────

test("workspace isolation: workspace A cannot see or use workspace B's definitions or instances", () => {
  // Set up workspace A: a definition with a working transition.
  const defA = seedDefinition("ws_A", "defA", {
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      done: { id: "done", label: "Done" },
    },
    transitions: {
      t1: { id: "t1", from: "idle", to: "done", kind: "explicit", event: "go" },
    },
  });

  // Workspace A creates an instance and advances it.
  const resultA = handleWorkflowTask({
    workspaceId: "ws_A",
    definitionId: defA,
    event: { type: "SIGNAL", signal: "go" },
  });
  assert.equal(resultA.currentState, "done");
  assert.equal(resultA.transitioned, true);

  // Workspace B tries to use workspace A's definition — should be rejected.
  assert.throws(
    () =>
      handleWorkflowTask({
        workspaceId: "ws_B",
        definitionId: defA,
        event: { type: "SIGNAL", signal: "go" },
      }),
    /does not belong to workspace ws_B/,
    "cross-workspace definition access rejected",
  );

  // Workspace B tries to advance workspace A's instance — also rejected.
  assert.throws(
    () =>
      handleWorkflowTask({
        workspaceId: "ws_B",
        definitionId: defA,
        instanceId: resultA.instanceId,
        event: { type: "SIGNAL", signal: "go" },
      }),
    /does not belong to workspace ws_B/,
    "cross-workspace instance access rejected",
  );

  // listWorkflowInstancesForWorkspaceSync scopes by workspace_id.
  const listA = listWorkflowInstancesForWorkspaceSync("ws_A");
  const listB = listWorkflowInstancesForWorkspaceSync("ws_B");
  assert.equal(listA.length, 1, "workspace A sees its 1 instance");
  assert.equal(listB.length, 0, "workspace B sees nothing");
  assert.equal(listA[0].id, resultA.instanceId);
});

// ── Bonus: existing instanceId path ──────────────────────────────────────────

test("with instanceId: advances an existing instance, no new instance created", () => {
  const WS = "ws_existing";
  const defId = seedDefinition(WS, "two-step", {
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      middle: { id: "middle", label: "Middle" },
      done: { id: "done", label: "Done" },
    },
    transitions: {
      t1: { id: "t1", from: "idle", to: "middle", kind: "explicit", event: "step1" },
      t2: { id: "t2", from: "middle", to: "done", kind: "explicit", event: "step2" },
    },
  });

  // Pre-create the instance (without an event).
  const r1 = handleWorkflowTask({
    workspaceId: WS,
    definitionId: defId,
  });
  assert.equal(r1.currentState, "idle");
  assert.equal(r1.transitioned, false);
  assert.equal(r1.historyCount, 0, "no history on spawn-only call");

  // Advance the same instance.
  const r2 = handleWorkflowTask({
    workspaceId: WS,
    definitionId: defId,
    instanceId: r1.instanceId,
    event: { type: "SIGNAL", signal: "step1" },
  });
  assert.equal(r2.instanceId, r1.instanceId, "same instance id");
  assert.equal(r2.currentState, "middle");
  assert.equal(r2.historyCount, 1);

  // And once more.
  const r3 = handleWorkflowTask({
    workspaceId: WS,
    definitionId: defId,
    instanceId: r1.instanceId,
    event: { type: "SIGNAL", signal: "step2" },
  });
  assert.equal(r3.instanceId, r1.instanceId);
  assert.equal(r3.currentState, "done");
  assert.equal(r3.status, "completed", "terminal state promoted to completed");
  assert.equal(r3.historyCount, 2);
});

// Suppress unused warning for the type import.
type _Unused = WorkflowInstanceRecord;
