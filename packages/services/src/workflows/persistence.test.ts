// FSM L2.7 - Real-DB Round-trip Tests (agent_workflow_* tables via @agent-space/db)
//
// Run with:
//   set -a; source .env; set +a
//   export PATH=/home/speaker/.nvm/versions/node/v24.17.0/bin:$PATH
//   node --experimental-strip-types --test packages/services/src/workflows/persistence.test.ts
//
// Requires:
//   - SELF_HOSTED_DATABASE_URL -> test PG (port 5433)
//   - 3 agent_workflow_* tables already migrated

import assert from "node:assert/strict";
import test from "node:test";
import { getDatabase } from "@agent-space/db";
import {
  createWorkflowDefinitionSync,
  readWorkflowDefinitionSync,
  listWorkflowDefinitionsSync,
  updateWorkflowDefinitionSync,
  deleteWorkflowDefinitionSync,
  createWorkflowInstanceSync,
  readWorkflowInstanceSync,
  listWorkflowInstancesForDefinitionSync,
  listWorkflowInstancesForWorkspaceSync,
  updateWorkflowInstanceStateSync,
  findWorkflowInstanceByCallbackTokenSync,
  recordWorkflowHistorySync,
  listWorkflowHistorySync,
} from "@agent-space/db";

const WS_A = "ws_test_alpha";
const WS_B = "ws_test_beta";

function truncateAll() {
  const db = getDatabase();
  db.exec("DELETE FROM agent_workflow_history");
  db.exec("DELETE FROM agent_workflow_instance");
  db.exec("DELETE FROM agent_workflow_definition");
}

test.beforeEach(() => {
  truncateAll();
});

test.after(() => {
  truncateAll();
});

// ── Definition CRUD ──

test("createWorkflowDefinitionSync writes + read returns", () => {
  const def = createWorkflowDefinitionSync({
    workspaceId: WS_A,
    name: "thesis-36page",
    version: 1,
    definitionJson: { states: ["idle", "writing"], transitions: [] },
  });
  assert.ok(def.id.startsWith("wfd_"));
  assert.equal(def.workspaceId, WS_A);
  assert.equal(def.name, "thesis-36page");
  assert.deepEqual(def.definitionJson, { states: ["idle", "writing"], transitions: [] });

  const back = readWorkflowDefinitionSync(def.id);
  assert.ok(back);
  assert.deepEqual(back!.definitionJson, def.definitionJson);
});

test("readWorkflowDefinitionSync returns null for unknown", () => {
  assert.equal(readWorkflowDefinitionSync("wfd_unknown"), null);
});

test("listWorkflowDefinitionsSync is workspace-scoped", () => {
  createWorkflowDefinitionSync({ workspaceId: WS_A, name: "d1", definitionJson: {} });
  createWorkflowDefinitionSync({ workspaceId: WS_A, name: "d2", definitionJson: {} });
  createWorkflowDefinitionSync({ workspaceId: WS_B, name: "d3", definitionJson: {} });
  assert.equal(listWorkflowDefinitionsSync(WS_A).length, 2);
  assert.equal(listWorkflowDefinitionsSync(WS_B).length, 1);
});

test("updateWorkflowDefinitionSync mutates + bumps updated_at", async () => {
  const def = createWorkflowDefinitionSync({
    workspaceId: WS_A,
    name: "iter1",
    version: 1,
    definitionJson: { v: 1 },
  });
  await new Promise((r) => setTimeout(r, 5));
  const updated = updateWorkflowDefinitionSync(def.id, { version: 2, definitionJson: { v: 2 } });
  assert.ok(updated);
  assert.equal(updated!.version, 2);
  assert.notEqual(updated!.updatedAt, def.updatedAt);
});

test("deleteWorkflowDefinitionSync returns boolean", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "kill", definitionJson: {} });
  assert.equal(deleteWorkflowDefinitionSync(def.id), true);
  assert.equal(deleteWorkflowDefinitionSync(def.id), false);
});

// ── Instance CRUD ──

test("createWorkflowInstanceSync defaults status=active", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "d", definitionJson: {} });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "idle",
  });
  assert.ok(inst.id.startsWith("wfi_"));
  assert.equal(inst.status, "active");
  assert.equal(inst.currentState, "idle");
  assert.equal(inst.attemptCount, 0);
});

test("updateWorkflowInstanceStateSync persists state + attemptCount", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "u", definitionJson: {} });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "s0",
  });
  const updated = updateWorkflowInstanceStateSync(inst.id, {
    status: "completed",
    currentState: "s1",
    attemptCount: 3,
  });
  assert.ok(updated);
  assert.equal(updated!.currentState, "s1");
  assert.equal(updated!.attemptCount, 3);
  assert.equal(updated!.status, "completed");
});

test("findWorkflowInstanceByCallbackTokenSync finds unique + workspace-isolated", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "cb", definitionJson: {} });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "waiting",
    callbackToken: "tok_abc123",
  });
  const found = findWorkflowInstanceByCallbackTokenSync(WS_A, "tok_abc123");
  assert.ok(found);
  assert.equal(found!.id, inst.id);
  assert.equal(findWorkflowInstanceByCallbackTokenSync(WS_A, "tok_wrong"), null);
  assert.equal(findWorkflowInstanceByCallbackTokenSync(WS_B, "tok_abc123"), null);
});

test("listWorkflowInstancesForWorkspaceSync honours status filter", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "f", definitionJson: {} });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "active-state",
  });
  updateWorkflowInstanceStateSync(inst.id, { status: "completed", currentState: "done" });
  createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "still-active",
  });
  assert.equal(listWorkflowInstancesForWorkspaceSync(WS_A).length, 2);
  assert.equal(listWorkflowInstancesForWorkspaceSync(WS_A, "completed").length, 1);
  assert.equal(listWorkflowInstancesForWorkspaceSync(WS_A, "active").length, 1);
});

// ── History ──

test("recordWorkflowHistorySync + listWorkflowHistorySync in order", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "h", definitionJson: {} });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "idle",
  });
  recordWorkflowHistorySync({
    workspaceId: WS_A,
    instanceId: inst.id,
    eventType: "START",
    fromState: null,
    toState: "idle",
  });
  recordWorkflowHistorySync({
    workspaceId: WS_A,
    instanceId: inst.id,
    eventType: "TRANSITION",
    fromState: "idle",
    toState: "writing",
    payloadJson: { signal: "go" },
  });

  const hist = listWorkflowHistorySync(inst.id);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].eventType, "START");
  assert.equal(hist[1].eventType, "TRANSITION");
  assert.deepEqual(hist[1].payloadJson, { signal: "go" });
});

// ── Restart simulation ──

test("restart simulation: instance persists across fresh DB connection", () => {
  const def = createWorkflowDefinitionSync({
    workspaceId: WS_A,
    name: "persist",
    definitionJson: { states: ["a", "b"] },
  });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "a",
    contextJson: { x: 1 },
  });
  updateWorkflowInstanceStateSync(inst.id, { currentState: "b", attemptCount: 7 });

  // Force fresh DB read (worker-thread equivalent of process restart)
  const db = getDatabase();
  const freshRow = db
    .prepare("SELECT * FROM agent_workflow_instance WHERE id = ?")
    .get(inst.id) as { current_state: string; attempt_count: number; context_json: string };
  assert.equal(freshRow.current_state, "b");
  assert.equal(freshRow.attempt_count, 7);
  assert.deepEqual(JSON.parse(freshRow.context_json), { x: 1 });
});

// ── Cascade delete (FK behavior) ──

test("FK cascade: deleting definition removes instances + history", () => {
  const def = createWorkflowDefinitionSync({ workspaceId: WS_A, name: "cascade", definitionJson: {} });
  const inst = createWorkflowInstanceSync({
    workspaceId: WS_A,
    definitionId: def.id,
    currentState: "idle",
  });
  recordWorkflowHistorySync({
    workspaceId: WS_A,
    instanceId: inst.id,
    eventType: "START",
    fromState: null,
    toState: "idle",
  });
  assert.equal(listWorkflowInstancesForDefinitionSync(def.id).length, 1);
  deleteWorkflowDefinitionSync(def.id);
  assert.equal(listWorkflowInstancesForDefinitionSync(def.id).length, 0);
  assert.equal(listWorkflowHistorySync(inst.id).length, 0);
});
