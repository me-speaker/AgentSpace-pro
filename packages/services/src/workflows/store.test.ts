// FSM 1.2 \u2014 Workflow Store CRUD tests
//
// Focused tests for the *Sync CRUD layer (the WorkflowStore interface).
// The runtime integration (runtime.test.ts) exercises end-to-end wiring;
// these tests pin down the contract of each store function in isolation.
//
// Run with: node --experimental-strip-types packages/services/src/workflows/store.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryWorkflowStore,
  createInMemoryWorkflowStore,
} from "./store.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedDefinition(
  store: InMemoryWorkflowStore,
  id = "def1",
  workspaceId = "ws1"
): void {
  store.createWorkflowDefinitionSync({
    id,
    workspaceId,
    name: "Test Workflow",
    version: 1,
    definition: { initialState: "idle" },
  });
}

// ── Definition CRUD ─────────────────────────────────────────────────────────

test("createWorkflowDefinitionSync \u2014 persists all fields", () => {
  const store = createInMemoryWorkflowStore();
  const def = store.createWorkflowDefinitionSync({
    id: "def1",
    workspaceId: "ws1",
    name: "Onboarding",
    version: 3,
    definition: { foo: "bar" },
  });
  assert.equal(def.id, "def1");
  assert.equal(def.workspaceId, "ws1");
  assert.equal(def.name, "Onboarding");
  assert.equal(def.version, 3);
  assert.deepEqual(def.definition, { foo: "bar" });
  assert.ok(def.createdAt);
  assert.ok(def.updatedAt);
});

test("createWorkflowDefinitionSync \u2014 duplicate id throws", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  assert.throws(
    () =>
      store.createWorkflowDefinitionSync({
        id: "def1",
        workspaceId: "ws1",
        name: "Other",
        definition: {},
      }),
    /already exists/
  );
});

test("readWorkflowDefinitionSync \u2014 returns null for unknown id", () => {
  const store = createInMemoryWorkflowStore();
  assert.equal(store.readWorkflowDefinitionSync("nope"), null);
});

test("updateWorkflowDefinitionSync \u2014 patches name + version + body", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  const updated = store.updateWorkflowDefinitionSync("def1", {
    name: "Renamed",
    version: 2,
    definition: { next: true },
  });
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.definition, { next: true });
  assert.equal(updated.workspaceId, "ws1", "workspace_id is immutable");
});

test("updateWorkflowDefinitionSync \u2014 unknown id throws", () => {
  const store = createInMemoryWorkflowStore();
  assert.throws(
    () => store.updateWorkflowDefinitionSync("nope", { name: "x" }),
    /not found/
  );
});

test("deleteWorkflowDefinitionSync \u2014 cascades to instances + history", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  store.createWorkflowInstanceSync({
    id: "inst1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "idle",
  });
  store.recordWorkflowHistorySync({
    id: "h1",
    workspaceId: "ws1",
    instanceId: "inst1",
    eventType: "START",
    fromState: null,
    toState: "idle",
    payload: {},
  });
  const before = store.sizes();
  assert.equal(before.definitions, 1);
  assert.equal(before.instances, 1);
  assert.equal(before.history, 1);

  assert.equal(store.deleteWorkflowDefinitionSync("def1"), true);
  const after = store.sizes();
  assert.equal(after.definitions, 0);
  assert.equal(after.instances, 0, "instance cascade");
  assert.equal(after.history, 0, "history cascade");
});

test("deleteWorkflowDefinitionSync \u2014 returns false for missing id", () => {
  const store = createInMemoryWorkflowStore();
  assert.equal(store.deleteWorkflowDefinitionSync("nope"), false);
});

// ── Instance CRUD ───────────────────────────────────────────────────────────

test("createWorkflowInstanceSync \u2014 requires definition FK", () => {
  const store = createInMemoryWorkflowStore();
  assert.throws(
    () =>
      store.createWorkflowInstanceSync({
        id: "inst1",
        workspaceId: "ws1",
        definitionId: "missing",
        currentState: "idle",
      }),
    /WorkflowDefinition 'missing' not found/
  );
});

test("createWorkflowInstanceSync \u2014 requires matching workspace_id", () => {
  const store = createInMemoryWorkflowStore();
  store.createWorkflowDefinitionSync({
    id: "def1",
    workspaceId: "wsA",
    name: "A",
    definition: {},
  });
  assert.throws(
    () =>
      store.createWorkflowInstanceSync({
        id: "inst1",
        workspaceId: "wsB",
        definitionId: "def1",
        currentState: "idle",
      }),
    /Workspace mismatch/
  );
});

test("createWorkflowInstanceSync \u2014 default status = active, attemptCount = 0", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  const inst = store.createWorkflowInstanceSync({
    id: "inst1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "idle",
  });
  assert.equal(inst.status, "active");
  assert.equal(inst.attemptCount, 0);
  assert.deepEqual(inst.context, {});
  assert.equal(inst.deadlineAt, null);
  assert.equal(inst.callbackToken, null);
});

test("listWorkflowInstancesForWorkspaceSync \u2014 filters by status", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  store.createWorkflowInstanceSync({
    id: "i1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "running",
    status: "active",
  });
  store.createWorkflowInstanceSync({
    id: "i2",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "waiting",
    status: "waiting",
  });
  store.createWorkflowInstanceSync({
    id: "i3",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "completed",
    status: "completed",
  });

  const all = store.listWorkflowInstancesForWorkspaceSync("ws1");
  assert.equal(all.length, 3);
  const waiting = store.listWorkflowInstancesForWorkspaceSync("ws1", "waiting");
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].id, "i2");
  const other = store.listWorkflowInstancesForWorkspaceSync("ws2");
  assert.equal(other.length, 0, "cross-workspace isolation");
});

test("updateWorkflowInstanceStateSync \u2014 patches are merged", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  store.createWorkflowInstanceSync({
    id: "i1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "idle",
  });
  const updated = store.updateWorkflowInstanceStateSync("i1", {
    status: "waiting",
    currentState: "waiting",
    context: { x: 1 },
    callbackToken: "tok-1",
    deadlineAt: new Date(Date.now() + 5000).toISOString(),
  });
  assert.equal(updated.status, "waiting");
  assert.equal(updated.currentState, "waiting");
  assert.deepEqual(updated.context, { x: 1 });
  assert.equal(updated.callbackToken, "tok-1");
  assert.ok(updated.deadlineAt);
});

test("findWorkflowInstanceByCallbackTokenSync \u2014 returns null when no match", () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  store.createWorkflowInstanceSync({
    id: "i1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "waiting",
    callbackToken: "tok-a",
  });
  assert.equal(
    store.findWorkflowInstanceByCallbackTokenSync("ws1", "tok-missing"),
    null
  );
  assert.equal(
    store.findWorkflowInstanceByCallbackTokenSync("wsOther", "tok-a"),
    null
  );
});

// ── History ─────────────────────────────────────────────────────────────────

test("recordWorkflowHistorySync \u2014 requires instance FK", () => {
  const store = createInMemoryWorkflowStore();
  assert.throws(
    () =>
      store.recordWorkflowHistorySync({
        id: "h1",
        workspaceId: "ws1",
        instanceId: "missing",
        eventType: "START",
        fromState: null,
        toState: "idle",
        payload: {},
      }),
    /WorkflowInstance 'missing' not found/
  );
});

test("listWorkflowHistorySync \u2014 returns entries in createdAt order", async () => {
  const store = createInMemoryWorkflowStore();
  seedDefinition(store);
  store.createWorkflowInstanceSync({
    id: "i1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "running",
  });
  // Add tiny delays so timestamps differ deterministically
  store.recordWorkflowHistorySync({
    id: "h1",
    workspaceId: "ws1",
    instanceId: "i1",
    eventType: "START",
    fromState: null,
    toState: "idle",
    payload: {},
  });
  await new Promise((r) => setTimeout(r, 2));
  store.recordWorkflowHistorySync({
    id: "h2",
    workspaceId: "ws1",
    instanceId: "i1",
    eventType: "SIGNAL",
    fromState: "idle",
    toState: "running",
    payload: { transitionId: "t1" },
  });
  const hist = store.listWorkflowHistorySync("i1");
  assert.equal(hist.length, 2);
  assert.equal(hist[0].id, "h1");
  assert.equal(hist[1].id, "h2");
});

test("listWorkflowHistorySync \u2014 empty for unknown instance", () => {
  const store = createInMemoryWorkflowStore();
  assert.deepEqual(store.listWorkflowHistorySync("nope"), []);
});

test("clear \u2014 wipes all entities", () => {
  const store = new InMemoryWorkflowStore();
  seedDefinition(store);
  store.createWorkflowInstanceSync({
    id: "i1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "idle",
  });
  store.recordWorkflowHistorySync({
    id: "h1",
    workspaceId: "ws1",
    instanceId: "i1",
    eventType: "START",
    fromState: null,
    toState: "idle",
    payload: {},
  });
  assert.equal(store.sizes().definitions, 1);
  store.clear();
  const after = store.sizes();
  assert.equal(after.definitions, 0);
  assert.equal(after.instances, 0);
  assert.equal(after.history, 0);
});

console.log("FSM store tests loaded \u2014 run with: node --test store.test.ts");