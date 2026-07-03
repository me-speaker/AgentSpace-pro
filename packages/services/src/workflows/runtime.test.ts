// FSM 1.2 — Workflow Runtime Unit Tests (standalone, no package imports)
// Run with: node --test runtime.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkflowInstance,
  executeTransition,
  evaluateGuards,
  findTransition,
  advanceAuto,
  resumeFromCallback,
} from "./runtime.ts";

// ── Inline types mirroring domain/workflows.ts ───────────────────────────────

interface WorkflowGuard { id: string; label: string; condition: string; required?: boolean; }
interface WorkflowAction { id: string; label: string; service: string; args?: Record<string,unknown>; phase: "enter"|"exit"|"transition"; continueOnError?: boolean; }
interface WorkflowTransition { id: string; from: string|string[]; to: string; event?: string; guards?: WorkflowGuard[]; actions?: WorkflowAction[]; kind: "explicit"|"automatic"|"callback"; }
interface WorkflowState { id: string; label: string; entryActions?: WorkflowAction[]; exitActions?: WorkflowAction[]; awaitingCallback?: boolean; timeoutMs?: number; autoTransition?: string; }
interface WorkflowDefinition { id: string; version: string; label: string; initialState: string; errorState?: string; timeoutState?: string; states: Record<string,WorkflowState>; transitions: Record<string,WorkflowTransition>; }
interface WorkflowHistoryEntry { idx: number; timestamp: string; fromState: string|null; toState: string; transitionId: string|null; eventName: string|null; guardResults?: Record<string,boolean>; actionResults?: Record<string,"ok"|"error">; error?: string; }
interface WorkflowInstance {
  id: string; definitionId: string; definitionVersion: string; workspaceId: string;
  status: "idle"|"running"|"waiting"|"completed"|"failed"|"cancelled";
  currentState: string; context: Record<string,unknown>; variables: Record<string,unknown>;
  label?: string; createdAt: string; updatedAt: string;
  attempts: Record<string,number>; attemptLimit?: number;
  history: WorkflowHistoryEntry[]; callStack: string[];
  callbackToken?: string; deadline?: string; error?: string;
}
type WorkflowEvent =
  | { type: "START"; payload?: Record<string,unknown> }
  | { type: "SIGNAL"; signal: string; payload?: Record<string,unknown> }
  | { type: "CALLBACK"; token: string; payload?: Record<string,unknown> }
  | { type: "TIMEOUT" }
  | { type: "CANCEL"; reason?: string }
  | { type: "ERROR"; error: string };

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeDef(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    id: "test-wf", version: "1.0.0", label: "Test Workflow",
    initialState: "idle", errorState: "error",
    states: {
      idle:      { id: "idle",      label: "Idle" },
      running:   { id: "running",   label: "Running" },
      waiting:   { id: "waiting",   label: "Waiting", awaitingCallback: true, timeoutMs: 5000 },
      completed: { id: "completed", label: "Completed" },
      error:     { id: "error",     label: "Error" },
    },
    transitions: {
      t1: { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start" },
      t2: { id: "t2", from: "running", to: "waiting", kind: "automatic" },
      t3: { id: "t3", from: "waiting", to: "completed", kind: "callback" },
      t4: { id: "t4", from: "*", to: "error", kind: "explicit", event: "fail" },
    },
    ...overrides,
  };
}

function createInstance(
  def: WorkflowDefinition,
  workspaceId = "ws1",
  payload?: Record<string,unknown>,
  label?: string,
  attemptLimit?: number
): WorkflowInstance {
  const now = new Date().toISOString();
  return {
    id: `wfi_test_${Date.now()}`,
    definitionId: def.id,
    definitionVersion: def.version,
    workspaceId,
    status: "running",
    currentState: def.initialState,
    context: payload ?? {},
    variables: {},
    label,
    createdAt: now,
    updatedAt: now,
    attempts: {},
    attemptLimit,
    history: [{ idx: 0, timestamp: now, fromState: null, toState: def.initialState, transitionId: null, eventName: "START" }],
    callStack: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("createWorkflowInstance — initialises correctly", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1", { foo: "bar" }, "My Workflow");

  assert.equal(instance.definitionId, "test-wf");
  assert.equal(instance.definitionVersion, "1.0.0");
  assert.equal(instance.workspaceId, "ws1");
  assert.equal(instance.status, "running");
  assert.equal(instance.currentState, "idle");
  assert.deepEqual(instance.context, { foo: "bar" });
  assert.equal(instance.label, "My Workflow");
  assert.equal(instance.history.length, 1);
  assert.equal(instance.history[0].fromState, null);
  assert.equal(instance.history[0].toState, "idle");
  assert.equal(instance.history[0].eventName, "START");
});

test("executeTransition — explicit transition moves state", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1");

  const { instance: inst2, result } = executeTransition(
    instance, { type: "SIGNAL", signal: "start" }, def
  );

  assert.equal(result.transitioned, true);
  assert.equal(result.toState, "running");
  assert.equal(inst2.currentState, "running");
  assert.equal(inst2.history.length, 2);
  assert.equal(inst2.history[1].fromState, "idle");
  assert.equal(inst2.history[1].toState, "running");
  assert.equal(inst2.attempts["t1"], 1);
});

test("executeTransition — guards block transition", () => {
  const def = makeDef({
    transitions: {
      t1: { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start",
        guards: [{ id: "g1", label: "must be ready", condition: "ctx.ready === true", required: true }],
      },
    },
  });
  const instance = createWorkflowInstance(def, "ws1", { ready: false });

  const { instance: inst2, result } = executeTransition(
    instance, { type: "SIGNAL", signal: "start" }, def
  );

  assert.equal(result.transitioned, false);
  assert.equal(inst2.currentState, "idle");
  // P0-3 (2026-07-03): error message now includes the structured
  // reason "guard 'g1' failed" (was previously "No matching transition
  // for event 'SIGNAL' in state 'idle'"). The detail field is set
  // by findTransitionWithReason when a guard is the cause.
  assert.ok(result.error?.includes("guard 'g1' failed"));
  assert.equal(result.reason, "guard_failed");
});

test("executeTransition — optional guard (required=false) allows transition", () => {
  const def = makeDef({
    transitions: {
      t1: { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start",
        guards: [{ id: "g1", label: "optional", condition: "ctx.optional == true", required: false }],
      },
    },
  });
  const instance = createWorkflowInstance(def, "ws1", { optional: false });

  const { instance: inst2, result } = executeTransition(
    instance, { type: "SIGNAL", signal: "start" }, def
  );

  assert.equal(result.transitioned, true);
  assert.equal(inst2.currentState, "running");
});

test("executeTransition — auto transition fires on START", () => {
  const def = makeDef({
    transitions: {
      auto1: { id: "auto1", from: "idle", to: "running", kind: "automatic" },
    },
    states: {
      idle:    { id: "idle",    label: "Idle",    autoTransition: "auto1" },
      running: { id: "running", label: "Running" },
    },
  });
  const instance = createWorkflowInstance(def, "ws1");

  const { instance: inst2, result } = executeTransition(instance, { type: "START" }, def);

  assert.equal(result.transitioned, true);
  assert.equal(inst2.currentState, "running");
});

test("executeTransition — error-state transition sets status=failed", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1");

  const { instance: inst2, result } = executeTransition(
    instance, { type: "SIGNAL", signal: "fail", payload: { reason: "oops" } }, def
  );

  assert.equal(result.transitioned, true);
  assert.equal(inst2.currentState, "error");
  assert.equal(inst2.status, "failed");
});

test("executeTransition — waiting state sets deadline", () => {
  const def = makeDef();
  let instance = createWorkflowInstance(def, "ws1");

  // idle → running
  ({ instance } = executeTransition(instance, { type: "SIGNAL", signal: "start" }, def));
  // running → waiting (auto on START)
  ({ instance } = executeTransition(instance, { type: "START" }, def));

  assert.equal(instance.currentState, "waiting");
  assert.equal(instance.status, "waiting");
  assert.ok(instance.deadline != null);
});

test("executeTransition — attempt limit exceeded sets status=failed", () => {
  // Build a loop: idle -> running (t1) -> idle (tback) so we can retry t1
  const def = makeDef({
    transitions: {
      t1:   { id: "t1",   from: "idle",    to: "running", kind: "explicit", event: "start" },
      tback:{ id: "tback", from: "running", to: "idle",   kind: "explicit", event: "back" },
    },
    states: {
      idle:    { id: "idle",    label: "Idle"    },
      running: { id: "running", label: "Running" },
      waiting: { id: "waiting", label: "Waiting" },
      completed:{ id:"completed",label:"Completed"},
      error:   { id: "error",   label: "Error"   },
    },
  });
  // Use createInstance helper (accepts attemptLimit) not createWorkflowInstance
  let instance = createInstance(def, "ws1", {}, undefined, 2);

  // 1st: idle→running (attempts.t1=1)
  ({ instance } = executeTransition(instance, { type: "SIGNAL", signal: "start" }, def));
  assert.equal(instance.attempts["t1"], 1, "first attempt");

  // 2nd: running→idle via tback, then idle→running via t1 again (attempts.t1=2)
  ({ instance } = executeTransition(instance, { type: "SIGNAL", signal: "back" }, def));
  ({ instance } = executeTransition(instance, { type: "SIGNAL", signal: "start" }, def));
  assert.equal(instance.attempts["t1"], 2, "second attempt");

  // 3rd: should exceed limit
  ({ instance } = executeTransition(instance, { type: "SIGNAL", signal: "back" }, def));
  const { instance: instFail, result } = executeTransition(
    instance, { type: "SIGNAL", signal: "start" }, def
  );
  assert.equal(instFail.status, "failed");
  assert.ok(result.error?.includes("Attempt limit exceeded"));
});

test("evaluateGuards — all pass returns true", () => {
  const transition: WorkflowTransition = {
    id: "t1", from: "idle", to: "running", kind: "explicit", event: "start",
    guards: [
      { id: "g1", label: "a", condition: "ctx.x > 0" },
      { id: "g2", label: "b", condition: "ctx.y === 'yes'" },
    ],
  };
  const result = evaluateGuards(transition, { x: 5, y: "yes" });
  assert.equal(result.passed, true);
});

test("evaluateGuards — required guard fails returns false + failedGuard id", () => {
  const transition: WorkflowTransition = {
    id: "t1", from: "idle", to: "running", kind: "explicit", event: "start",
    guards: [{ id: "g1", label: "must be ready", condition: "ctx.ready === true", required: true }],
  };
  const result = evaluateGuards(transition, { ready: false });
  assert.equal(result.passed, false);
  assert.equal(result.failedGuard, "g1");
});

test("findTransition — event match + guard pass", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1", { ready: true });
  const t = findTransition(def, instance, { type: "SIGNAL", signal: "start" });
  assert.equal(t?.id, "t1");
});

test("findTransition — no match when event differs", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1");
  const t = findTransition(def, instance, { type: "SIGNAL", signal: "wrong-signal" });
  assert.equal(t, null);
});

test("findTransition — callback requires token match", () => {
  const def = makeDef();
  // Need instance in 'waiting' state AND callbackToken set
  let instance = createWorkflowInstance(def, "ws1");
  // Manually set to waiting state with token (simulating a paused workflow)
  instance = {
    ...instance,
    status: "waiting",
    currentState: "waiting",
    callbackToken: "tok123",
  };

  const t = findTransition(def, instance, { type: "CALLBACK", token: "tok123" });
  assert.equal(t?.id, "t3");

  const tBad = findTransition(def, instance, { type: "CALLBACK", token: "wrong" });
  assert.equal(tBad, null);
});

test("advanceAuto — no auto transition returns transitioned=false", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1"); // idle has no autoTransition
  const { result } = advanceAuto(instance, def);
  assert.equal(result.transitioned, false);
  assert.ok(result.error?.includes("No auto-transition"));
});

test("resumeFromCallback — non-waiting instance rejects", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1");
  const { result } = resumeFromCallback(instance, { type: "CALLBACK", token: "tok" }, def);
  assert.ok(result.error?.includes("not in 'waiting' state"));
});

test("executeTransition — event payload merges into context", () => {
  const def = makeDef();
  const instance = createWorkflowInstance(def, "ws1", { existing: true });

  const { instance: inst2 } = executeTransition(
    instance, { type: "SIGNAL", signal: "start", payload: { newKey: 42 } }, def
  );

  assert.equal(inst2.context["existing"], true);
  assert.equal(inst2.context["newKey"], 42);
});

test("executeTransition — history entry has guardResults", () => {
  const def = makeDef({
    transitions: {
      t1: { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start",
        guards: [{ id: "g1", label: "test", condition: "ctx.x > 0" }],
      },
    },
  });
  const instance = createWorkflowInstance(def, "ws1", { x: 5 });

  const { instance: inst2 } = executeTransition(
    instance, { type: "SIGNAL", signal: "start" }, def
  );

  assert.deepEqual(inst2.history[1].guardResults, { g1: true });
});

test("executeTransition — wildcard '*' matches any source state", () => {
  const def = makeDef();
  // t4: from: '*', to: 'error', event: 'fail'
  const instance = createWorkflowInstance(def, "ws1"); // currentState = idle

  const { instance: inst2 } = executeTransition(
    instance, { type: "SIGNAL", signal: "fail" }, def
  );
  assert.equal(inst2.currentState, "error");
  assert.equal(inst2.history[1].fromState, "idle");
});

// ── L2 Round-Trip Tests (store + VM sandbox) ────────────────────────────────
//
// These exercise the L2 wiring: store-backed persistence through
// createWorkflowInstance + executeTransition, and the VM sandbox model
// (timeout / sandbox isolation). The InMemoryWorkflowStore is the
// reference implementation; the same interface applies to the future
// Postgres-backed store.

import {
  setStore,
  getStore,
  GUARD_VM_TIMEOUT_MS,
} from "./runtime.ts";
import {
  createInMemoryWorkflowStore,
  InMemoryWorkflowStore,
} from "./store.ts";

test("store — create + read definition round-trips fields", () => {
  const store = createInMemoryWorkflowStore();
  const created = store.createWorkflowDefinitionSync({
    id: "def1",
    workspaceId: "wsA",
    name: "Onboarding",
    version: 2,
    definition: { states: { idle: { id: "idle" } }, initialState: "idle" },
  });
  assert.equal(created.id, "def1");
  assert.equal(created.name, "Onboarding");
  assert.equal(created.version, 2);

  const read = store.readWorkflowDefinitionSync("def1");
  assert.ok(read, "definition should be readable");
  assert.equal(read?.workspaceId, "wsA");
  assert.equal(read?.name, "Onboarding");
  assert.deepEqual(read?.definition, {
    states: { idle: { id: "idle" } },
    initialState: "idle",
  });
});

test("store — list filters by workspace_id (cross-workspace isolation)", () => {
  const store = createInMemoryWorkflowStore();
  store.createWorkflowDefinitionSync({
    id: "defA",
    workspaceId: "wsA",
    name: "A1",
    definition: {},
  });
  store.createWorkflowDefinitionSync({
    id: "defB",
    workspaceId: "wsB",
    name: "B1",
    definition: {},
  });
  store.createWorkflowDefinitionSync({
    id: "defA2",
    workspaceId: "wsA",
    name: "A2",
    definition: {},
  });

  const aOnly = store.listWorkflowDefinitionsSync("wsA");
  assert.equal(aOnly.length, 2);
  assert.ok(aOnly.every((d) => d.workspaceId === "wsA"));
  assert.deepEqual(
    aOnly.map((d) => d.name).sort(),
    ["A1", "A2"]
  );

  const bOnly = store.listWorkflowDefinitionsSync("wsB");
  assert.equal(bOnly.length, 1);
  assert.equal(bOnly[0].id, "defB");

  const empty = store.listWorkflowDefinitionsSync("wsMissing");
  assert.equal(empty.length, 0);
});

test("store — instance FK enforces definition existence + workspace match", () => {
  const store = createInMemoryWorkflowStore();
  store.createWorkflowDefinitionSync({
    id: "defX",
    workspaceId: "wsX",
    name: "X",
    definition: {},
  });

  // Missing definition
  assert.throws(
    () =>
      store.createWorkflowInstanceSync({
        id: "inst1",
        workspaceId: "wsX",
        definitionId: "defMissing",
        currentState: "idle",
      }),
    /WorkflowDefinition 'defMissing' not found/
  );

  // Workspace mismatch
  assert.throws(
    () =>
      store.createWorkflowInstanceSync({
        id: "inst2",
        workspaceId: "wsOther",
        definitionId: "defX",
        currentState: "idle",
      }),
    /Workspace mismatch/
  );

  // Happy path
  const inst = store.createWorkflowInstanceSync({
    id: "inst3",
    workspaceId: "wsX",
    definitionId: "defX",
    currentState: "idle",
    context: { foo: "bar" },
  });
  assert.equal(inst.status, "active");
  assert.deepEqual(inst.context, { foo: "bar" });
});

test("store — round-trip: create instance → state updates → history", () => {
  const store = createInMemoryWorkflowStore();
  store.createWorkflowDefinitionSync({
    id: "def1",
    workspaceId: "ws1",
    name: "Test",
    definition: { initialState: "idle" },
  });
  store.createWorkflowInstanceSync({
    id: "inst1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "idle",
  });
  store.recordWorkflowHistorySync({
    id: "h_start",
    workspaceId: "ws1",
    instanceId: "inst1",
    eventType: "START",
    fromState: null,
    toState: "idle",
    payload: {},
  });

  // Simulate executeTransition side-effects
  store.updateWorkflowInstanceStateSync("inst1", {
    status: "running",
    currentState: "running",
    attemptCount: 1,
  });
  store.recordWorkflowHistorySync({
    id: "h_t1",
    workspaceId: "ws1",
    instanceId: "inst1",
    eventType: "SIGNAL",
    fromState: "idle",
    toState: "running",
    payload: { transitionId: "t1" },
  });

  const inst = store.readWorkflowInstanceSync("inst1");
  assert.ok(inst);
  assert.equal(inst?.status, "running");
  assert.equal(inst?.currentState, "running");
  assert.equal(inst?.attemptCount, 1);

  const hist = store.listWorkflowHistorySync("inst1");
  assert.equal(hist.length, 2);
  assert.equal(hist[0].eventType, "START");
  assert.equal(hist[1].eventType, "SIGNAL");
  assert.equal(hist[1].fromState, "idle");
  assert.equal(hist[1].toState, "running");
});

test("store — callback token lookup scopes by workspace", () => {
  const store = createInMemoryWorkflowStore();
  store.createWorkflowDefinitionSync({
    id: "def1",
    workspaceId: "ws1",
    name: "D",
    definition: {},
  });
  store.createWorkflowDefinitionSync({
    id: "def2",
    workspaceId: "ws2",
    name: "D",
    definition: {},
  });
  store.createWorkflowInstanceSync({
    id: "inst1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "waiting",
    callbackToken: "tok-shared",
  });
  store.createWorkflowInstanceSync({
    id: "inst2",
    workspaceId: "ws2",
    definitionId: "def2",
    currentState: "waiting",
    callbackToken: "tok-shared",
  });

  const hit1 = store.findWorkflowInstanceByCallbackTokenSync("ws1", "tok-shared");
  assert.equal(hit1?.id, "inst1");

  const hit2 = store.findWorkflowInstanceByCallbackTokenSync("ws2", "tok-shared");
  assert.equal(hit2?.id, "inst2");

  const miss = store.findWorkflowInstanceByCallbackTokenSync("ws3", "tok-shared");
  assert.equal(miss, null);
});

test("store — restart simulation: fresh store, seeded from JSON, reads back", () => {
  // Simulate a process restart by seeding a fresh store from a snapshot.
  const original = new InMemoryWorkflowStore();
  original.createWorkflowDefinitionSync({
    id: "def1",
    workspaceId: "ws1",
    name: "Onboarding",
    definition: { foo: "bar" },
  });
  original.createWorkflowInstanceSync({
    id: "inst1",
    workspaceId: "ws1",
    definitionId: "def1",
    currentState: "running",
    context: { count: 7 },
    attemptCount: 3,
    callbackToken: "tok-abc",
  });
  original.recordWorkflowHistorySync({
    id: "h1",
    workspaceId: "ws1",
    instanceId: "inst1",
    eventType: "SIGNAL",
    fromState: "idle",
    toState: "running",
    payload: { transitionId: "t1" },
  });

  // Snapshot and re-seed a brand-new store
  const snapshot = {
    def: original.readWorkflowDefinitionSync("def1"),
    inst: original.readWorkflowInstanceSync("inst1"),
    hist: original.listWorkflowHistorySync("inst1"),
  };

  const restarted = new InMemoryWorkflowStore();
  if (snapshot.def) {
    restarted.createWorkflowDefinitionSync({
      id: snapshot.def.id,
      workspaceId: snapshot.def.workspaceId,
      name: snapshot.def.name,
      version: snapshot.def.version,
      definition: snapshot.def.definition,
    });
  }
  if (snapshot.inst) {
    restarted.createWorkflowInstanceSync({
      id: snapshot.inst.id,
      workspaceId: snapshot.inst.workspaceId,
      definitionId: snapshot.inst.definitionId,
      status: snapshot.inst.status,
      currentState: snapshot.inst.currentState,
      context: snapshot.inst.context,
      attemptCount: snapshot.inst.attemptCount,
      callbackToken: snapshot.inst.callbackToken,
    });
  }
  for (const h of snapshot.hist) {
    restarted.recordWorkflowHistorySync({
      id: h.id,
      workspaceId: h.workspaceId,
      instanceId: h.instanceId,
      eventType: h.eventType,
      fromState: h.fromState,
      toState: h.toState,
      payload: h.payload,
    });
  }

  // After restart, the new store returns equivalent records
  const reDef = restarted.readWorkflowDefinitionSync("def1");
  assert.equal(reDef?.name, "Onboarding");
  const reInst = restarted.readWorkflowInstanceSync("inst1");
  assert.equal(reInst?.currentState, "running");
  assert.equal(reInst?.attemptCount, 3);
  assert.equal(reInst?.callbackToken, "tok-abc");
  assert.deepEqual(reInst?.context, { count: 7 });
  const reHist = restarted.listWorkflowHistorySync("inst1");
  assert.equal(reHist.length, 1);
  assert.equal(reHist[0].eventType, "SIGNAL");
});

test("runtime — wired to store persists create + transition side-effects", () => {
  const store = new InMemoryWorkflowStore();
  setStore(store);

  try {
    const def = makeDef();
    // Pre-register definition (FK requirement for instance)
    store.createWorkflowDefinitionSync({
      id: def.id,
      workspaceId: "ws1",
      name: "Test Workflow",
      definition: def as unknown as Record<string, unknown>,
    });

    const inst = createWorkflowInstance(def, "ws1", { hello: "world" }, "L2 Test");
    // After createWorkflowInstance, store should have 1 instance + 1 START history
    assert.ok(store.readWorkflowInstanceSync(inst.id), "instance persisted");
    assert.equal(
      store.listWorkflowHistorySync(inst.id).length,
      1,
      "START history persisted"
    );

    // Execute transition — should persist updated state + new history
    const { instance: inst2, result } = executeTransition(
      inst,
      { type: "SIGNAL", signal: "start" },
      def
    );
    assert.equal(result.transitioned, true);

    const stored = store.readWorkflowInstanceSync(inst.id);
    assert.ok(stored);
    assert.equal(stored?.currentState, "running");
    assert.equal(stored?.status, "active");

    const hist = store.listWorkflowHistorySync(inst.id);
    assert.equal(hist.length, 2);
    assert.equal(hist[1].eventType, "SIGNAL");
    assert.equal(hist[1].fromState, "idle");
    assert.equal(hist[1].toState, "running");
    assert.equal((hist[1].payload as { transitionId?: string }).transitionId, "t1");

    // Suppress unused warning for the in-flight instance
    void inst2;
  } finally {
    setStore(null);
    assert.equal(getStore(), null, "store should reset cleanly");
  }
});

test("runtime — without store set, behaves purely in-memory (no persistence)", () => {
  setStore(null);
  assert.equal(getStore(), null);

  const store = new InMemoryWorkflowStore();
  // Intentionally do NOT call setStore(store) — runtime should remain pure.
  const def = makeDef();
  store.createWorkflowDefinitionSync({
    id: def.id,
    workspaceId: "ws1",
    name: "Test Workflow",
    definition: def as unknown as Record<string, unknown>,
  });

  const inst = createWorkflowInstance(def, "ws1");
  // Store is empty because runtime was not wired to it
  assert.equal(store.readWorkflowInstanceSync(inst.id), null);
  assert.equal(store.listWorkflowHistorySync(inst.id).length, 0);

  // FSM still works in-memory
  const { result } = executeTransition(
    inst,
    { type: "SIGNAL", signal: "start" },
    def
  );
  assert.equal(result.transitioned, true);
});

test("guard eval — VM sandbox timeout interrupts runaway condition", () => {
  const guard = {
    id: "g1",
    label: "infinite",
    // Busy-loop that would hang the host if evaluated by `new Function`.
    condition: "(function () { var i = 0; while (true) { i++; } })() && true",
  };
  const startedAt = Date.now();
  const result = evaluateGuards(
    { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start", guards: [guard] },
    {}
  );
  const elapsed = Date.now() - startedAt;
  // Timeout fires, guard resolves to false, total time should be bounded.
  assert.equal(result.passed, false);
  assert.ok(
    elapsed < GUARD_VM_TIMEOUT_MS + 1500,
    `elapsed=${elapsed}ms should be < GUARD_VM_TIMEOUT_MS + 1500`
  );
});

test("guard eval — VM sandbox denies access to host globals", () => {
  // `process` is a host global; the VM context must NOT expose it.
  const guard = {
    id: "g1",
    label: "leak-process",
    condition: "typeof process !== 'undefined'",
  };
  const result = evaluateGuards(
    { id: "t1", from: "idle", to: "running", kind: "explicit", event: "start", guards: [guard] },
    {}
  );
  assert.equal(result.passed, false, "guard should not see host `process`");
});

console.log("FSM runtime tests loaded — run with: node --test runtime.test.ts");