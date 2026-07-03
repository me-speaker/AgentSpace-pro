// FSM L4.5 — End-to-end workflow lifecycle test (thesis-36page)
//
// Validates that L4.1 (handleWorkflowTask) and L4.2 (scheduler support
// via the daemon package) integrate cleanly with the existing L1/L2
// FSM runtime + DB layer.
//
// Scenario: "thesis-36page"
//   States: idle → outline → draft → review → done
//   Transitions:
//     start_outline  (idle → outline) + action sets context.outline
//     start_draft    (outline → draft)
//     submit_review  (draft → review) + guard: draftWordCount >= 1000
//     approve        (review → done)
//
// Steps (per the L4.5 spec):
//   1. createWorkflowDefinitionSync(...)  — the definition row
//   2. createWorkflowInstanceSync(...)    — the instance at idle
//   3. handleWorkflowTask(start_outline)  — scheduler-triggered advance
//   4. handleWorkflowTask(start_draft)    — scheduler-triggered advance
//   5. executeTransition(submit_review, { draftWordCount: 1500 }) — direct
//   6. executeTransition(approve)         — direct, lands at "done" terminal
//   7. assert listWorkflowHistorySync returns 4 records in order
//
// We use a file-based SQLite database (./.data/e2e.db) so this test
// is fully isolated from the in-memory singleton used by the other
// test files. .data/e2e.db is cleaned up in test.after().
//
// Run with:
//   node --experimental-strip-types --test \\
//       packages/services/src/workflows/e2e.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  resetDatabaseForTests,
  createWorkflowDefinitionSync,
  createWorkflowInstanceSync,
  readWorkflowInstanceSync,
  updateWorkflowInstanceStateSync,
  recordWorkflowHistorySync,
  listWorkflowHistorySync,
  type WorkflowInstanceRecord,
} from "@agent-space/db";
import { executeTransition } from "@agent-space/services";
import { handleWorkflowTask } from "@agent-space/daemon-test";
import type {
  WorkflowDefinition,
  WorkflowInstance,
} from "@agent-space/domain/workflows";

// ── Setup: file-based SQLite DB ─────────────────────────────────────────────

const WS_E2E = "ws_e2e_thesis";
const DB_DIR = resolve(process.cwd(), ".data");
const DB_PATH = resolve(DB_DIR, "e2e.db");

// MUST be set before any test code calls getDatabase() — the env var
// is read lazily on first connection, but we set it at module load to
// be safe.
process.env.WORKFLOW_TEST_DB_PATH = DB_PATH;

function cleanupDb(): void {
  try {
    rmSync(DB_PATH, { force: true });
  } catch {
    // ignore
  }
}

test.before(() => {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  cleanupDb();
  resetDatabaseForTests(); // clear the singleton so next getDatabase() reads the new env
});

test.after(() => {
  cleanupDb();
  resetDatabaseForTests();
});

test.beforeEach(() => {
  resetDatabaseForTests();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Runtime WorkflowStatus → DB WorkflowInstanceRecord.status */
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

/** Same terminal-state check the daemon uses. Replicated here so the
 *  e2e test can manually persist direct-executeTransition results
 *  with the same promotion rules. */
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

/** Build an in-memory WorkflowInstance from a DB record + definition. */
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

/** Persist a runtime instance + its last history entry to the DB,
 *  applying the same terminal-state promotion + status mapping rules
 *  the daemon uses. */
function persistTransition(
  instId: string,
  beforeInst: WorkflowInstance,
  afterInst: WorkflowInstance,
  def: WorkflowDefinition,
  eventType: string,
): void {
  let dbStatus = toStoreStatus(afterInst.status);
  if (isTerminalState(def, afterInst.currentState)) {
    dbStatus = "completed";
  }
  const attemptCount = Object.values(afterInst.attempts).reduce(
    (sum, n) => sum + n,
    0,
  );
  updateWorkflowInstanceStateSync(instId, {
    status: dbStatus,
    currentState: afterInst.currentState,
    contextJson: afterInst.context,
    attemptCount,
  });
  const lastHistory = afterInst.history[afterInst.history.length - 1];
  recordWorkflowHistorySync({
    workspaceId: afterInst.workspaceId,
    instanceId: instId,
    eventType,
    fromState: lastHistory?.fromState ?? beforeInst.currentState,
    toState: lastHistory?.toState ?? afterInst.currentState,
    payloadJson: {
      transitionId: lastHistory?.transitionId ?? null,
      guardResults: lastHistory?.guardResults ?? {},
      actionResults: lastHistory?.actionResults ?? {},
    },
  });
}

// ── The single integration test ─────────────────────────────────────────────

test("thesis-36page: full FSM lifecycle from idle to done via daemon + direct executeTransition", () => {
  // ── Step 1: Create the definition row ───────────────────────────────────
  const def: WorkflowDefinition = {
    id: "thesis-36page",
    version: "1.0.0",
    label: "Thesis 36-page",
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      outline: { id: "outline", label: "Outline" },
      draft: { id: "draft", label: "Draft" },
      review: { id: "review", label: "Review" },
      done: { id: "done", label: "Done" },
    },
    transitions: {
      t1: {
        id: "t1",
        from: "idle",
        to: "outline",
        kind: "explicit",
        event: "start_outline",
        actions: [
          {
            id: "a_outline",
            label: "set outline",
            service: "noop.set",
            args: { outline: "5-chapter skeleton" },
            phase: "transition",
          },
        ],
      },
      t2: {
        id: "t2",
        from: "outline",
        to: "draft",
        kind: "explicit",
        event: "start_draft",
      },
      t3: {
        id: "t3",
        from: "draft",
        to: "review",
        kind: "explicit",
        event: "submit_review",
        guards: [
          {
            id: "g_word_count",
            label: "min 1000 words",
            condition: "ctx.draftWordCount >= 1000",
            required: true,
          },
        ],
      },
      t4: {
        id: "t4",
        from: "review",
        to: "done",
        kind: "explicit",
        event: "approve",
      },
    },
  };

  const defRecord = createWorkflowDefinitionSync({
    workspaceId: WS_E2E,
    name: "thesis-36page",
    version: 1,
    definitionJson: def as unknown as Record<string, unknown>,
  });
  assert.ok(defRecord.id.startsWith("wfd_"));

  // ── Step 2: Create the instance at idle ────────────────────────────────
  const instRecord = createWorkflowInstanceSync({
    workspaceId: WS_E2E,
    definitionId: defRecord.id,
    currentState: "idle",
    contextJson: { title: "My Thesis" },
  });
  assert.equal(instRecord.currentState, "idle");
  assert.equal(listWorkflowHistorySync(instRecord.id).length, 0, "no history yet");

  // ── Step 3: handleWorkflowTask advances idle → outline (via the L4.1
  //    daemon; the L4.2 scheduler is what would call this in prod) ────
  const r3 = handleWorkflowTask({
    workspaceId: WS_E2E,
    definitionId: defRecord.id,
    instanceId: instRecord.id,
    event: { type: "SIGNAL", signal: "start_outline" },
  });
  assert.equal(r3.transitioned, true);
  assert.equal(r3.currentState, "outline");
  assert.equal(r3.historyCount, 1, "one history row from the daemon's fire");

  // ── Step 4: handleWorkflowTask advances outline → draft ───────────────
  const r4 = handleWorkflowTask({
    workspaceId: WS_E2E,
    definitionId: defRecord.id,
    instanceId: instRecord.id,
    event: { type: "SIGNAL", signal: "start_draft" },
  });
  assert.equal(r4.transitioned, true);
  assert.equal(r4.currentState, "draft");
  assert.equal(r4.historyCount, 2);

  // ── Step 5: Direct executeTransition advances draft → review, with
  //    a payload that satisfies the guard (draftWordCount >= 1000) ──
  let runtimeInst = buildRuntimeInstance(
    readWorkflowInstanceSync(instRecord.id)!,
    def,
  );
  const { instance: inst5, result: r5 } = executeTransition(
    runtimeInst,
    {
      type: "SIGNAL",
      signal: "submit_review",
      payload: { draftWordCount: 1500 },
    },
    def,
  );
  runtimeInst = inst5;
  assert.equal(r5.transitioned, true);
  assert.equal(inst5.currentState, "review");
  // Verify the guard was evaluated: runtime's last history entry has
  // guardResults for g_word_count.
  const hist5 = inst5.history[inst5.history.length - 1];
  assert.deepEqual(hist5.guardResults, { g_word_count: true });
  // The payload got merged into context.
  assert.equal(inst5.context.draftWordCount, 1500);

  persistTransition(instRecord.id, runtimeInst, inst5, def, "submit_review");
  assert.equal(listWorkflowHistorySync(instRecord.id).length, 3);

  // ── Step 6: Direct executeTransition advances review → done ─────────
  const { instance: inst6, result: r6 } = executeTransition(
    inst5,
    { type: "SIGNAL", signal: "approve" },
    def,
  );
  assert.equal(r6.transitioned, true);
  assert.equal(inst6.currentState, "done");

  persistTransition(instRecord.id, inst5, inst6, def, "approve");

  // ── Step 7: Assert history rows in order ──────────────────────────────
  const allHist = listWorkflowHistorySync(instRecord.id);
  assert.equal(allHist.length, 4, "exactly 4 history rows");

  assert.equal(allHist[0].eventType, "start_outline");
  assert.equal(allHist[0].fromState, "idle");
  assert.equal(allHist[0].toState, "outline");

  assert.equal(allHist[1].eventType, "start_draft");
  assert.equal(allHist[1].fromState, "outline");
  assert.equal(allHist[1].toState, "draft");

  assert.equal(allHist[2].eventType, "submit_review");
  assert.equal(allHist[2].fromState, "draft");
  assert.equal(allHist[2].toState, "review");

  assert.equal(allHist[3].eventType, "approve");
  assert.equal(allHist[3].fromState, "review");
  assert.equal(allHist[3].toState, "done");

  // ── Final state ──────────────────────────────────────────────────────
  const finalInst = readWorkflowInstanceSync(instRecord.id);
  assert.equal(finalInst?.currentState, "done");
  assert.equal(finalInst?.status, "completed", "terminal state promoted to completed");
});
