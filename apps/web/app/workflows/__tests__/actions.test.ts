// L4.3 — server-action tests.
//
// Uses Node 22's `mock.module()` (enabled by --experimental-test-module-mocks)
// to intercept @agent-space/db and @agent-space/services, then asserts:
//
//   1. Each action calls the expected CRUD/runtime function.
//   2. Action wrappers forward the right arguments (workspace scoping,
//      definition JSON passthrough, event/payload routing).
//   3. Mutation actions wrap DB writes in withTransaction (P0-2).
//
// Run with:
//   node --experimental-strip-types --experimental-test-module-mocks \
//       --test app/workflows/__tests__/actions.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";

// ── Mock state captured per test ────────────────────────────────────────────

interface MockCall {
  name: string;
  args: unknown[];
}

interface MockState {
  calls: MockCall[];
  definitions: Map<string, MockDefRecord>;
  instances: Map<string, MockInstRecord>;
  history: MockHistoryRecord[];
  txWraps: number;
}

interface MockDefRecord {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  definitionJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface MockInstRecord {
  id: string;
  workspaceId: string;
  definitionId: string;
  status: "active" | "completed" | "failed" | "waiting" | "cancelled";
  currentState: string;
  contextJson: Record<string, unknown>;
  attemptCount: number;
  deadlineAt: string | null;
  callbackToken: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MockHistoryRecord {
  id: string;
  workspaceId: string;
  instanceId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: string;
}

let state: MockState = {
  calls: [],
  definitions: new Map(),
  instances: new Map(),
  history: [],
  txWraps: 0,
};

function freshState(): MockState {
  return {
    calls: [],
    definitions: new Map(),
    instances: new Map(),
    history: [],
    txWraps: 0,
  };
}

function recordCall(name: string, args: unknown[]): void {
  state.calls.push({ name, args });
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeDefRecord(input: {
  workspaceId: string;
  name: string;
  version?: number;
  definitionJson: Record<string, unknown>;
}): MockDefRecord {
  const id = `wfd_mock_${state.definitions.size + 1}`;
  return {
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    version: input.version ?? 1,
    definitionJson: input.definitionJson,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function makeInstRecord(input: {
  workspaceId: string;
  definitionId: string;
  currentState?: string;
}): MockInstRecord {
  const id = `wfi_mock_${state.instances.size + 1}`;
  return {
    id,
    workspaceId: input.workspaceId,
    definitionId: input.definitionId,
    status: "active",
    currentState: input.currentState ?? "idle",
    contextJson: {},
    attemptCount: 0,
    deadlineAt: null,
    callbackToken: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

// ── Mocked @agent-space/db module ───────────────────────────────────────────

mock.module("@agent-space/db", {
  namedExports: {
    createWorkflowDefinitionSync: (input: {
      workspaceId: string;
      name: string;
      version?: number;
      definitionJson: Record<string, unknown>;
    }) => {
      recordCall("createWorkflowDefinitionSync", [input]);
      const rec = makeDefRecord(input);
      state.definitions.set(rec.id, rec);
      return rec;
    },
    readWorkflowDefinitionSync: (id: string) => {
      recordCall("readWorkflowDefinitionSync", [id]);
      return state.definitions.get(id) ?? null;
    },
    listWorkflowDefinitionsSync: (workspaceId: string) => {
      recordCall("listWorkflowDefinitionsSync", [workspaceId]);
      return Array.from(state.definitions.values()).filter(
        (d) => d.workspaceId === workspaceId,
      );
    },
    updateWorkflowDefinitionSync: (id: string, patch: Record<string, unknown>) => {
      recordCall("updateWorkflowDefinitionSync", [id, patch]);
      const existing = state.definitions.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      state.definitions.set(id, updated);
      return updated;
    },
    deleteWorkflowDefinitionSync: (id: string) => {
      recordCall("deleteWorkflowDefinitionSync", [id]);
      return state.definitions.delete(id);
    },
    createWorkflowInstanceSync: (input: {
      workspaceId: string;
      definitionId: string;
      currentState: string;
      contextJson?: Record<string, unknown>;
    }) => {
      recordCall("createWorkflowInstanceSync", [input]);
      const rec = makeInstRecord(input);
      state.instances.set(rec.id, rec);
      return rec;
    },
    readWorkflowInstanceSync: (id: string) => {
      recordCall("readWorkflowInstanceSync", [id]);
      return state.instances.get(id) ?? null;
    },
    listWorkflowInstancesForWorkspaceSync: (workspaceId: string) => {
      recordCall("listWorkflowInstancesForWorkspaceSync", [workspaceId]);
      return Array.from(state.instances.values()).filter(
        (i) => i.workspaceId === workspaceId,
      );
    },
    listWorkflowInstancesForDefinitionSync: (definitionId: string) => {
      recordCall("listWorkflowInstancesForDefinitionSync", [definitionId]);
      return Array.from(state.instances.values()).filter(
        (i) => i.definitionId === definitionId,
      );
    },
    updateWorkflowInstanceStateSync: (
      id: string,
      patch: Partial<MockInstRecord>,
    ) => {
      recordCall("updateWorkflowInstanceStateSync", [id, patch]);
      const existing = state.instances.get(id);
      if (!existing) return null;
      const merged = { ...existing, ...patch, updatedAt: nowIso() };
      state.instances.set(id, merged);
      return merged;
    },
    recordWorkflowHistorySync: (input: {
      workspaceId: string;
      instanceId: string;
      eventType: string;
      fromState?: string | null;
      toState?: string | null;
      payloadJson?: Record<string, unknown>;
    }) => {
      recordCall("recordWorkflowHistorySync", [input]);
      const rec: MockHistoryRecord = {
        id: `wfh_mock_${state.history.length + 1}`,
        workspaceId: input.workspaceId,
        instanceId: input.instanceId,
        eventType: input.eventType,
        fromState: input.fromState ?? null,
        toState: input.toState ?? null,
        payloadJson: input.payloadJson ?? {},
        createdAt: nowIso(),
      };
      state.history.push(rec);
      return rec;
    },
    listWorkflowHistorySync: (instanceId: string) => {
      recordCall("listWorkflowHistorySync", [instanceId]);
      return state.history.filter((h) => h.instanceId === instanceId);
    },
    withTransaction: (fn: () => unknown) => {
      recordCall("withTransaction", [fn]);
      state.txWraps += 1;
      return fn();
    },
    getDatabase: () => ({}),
    resetDatabaseForTests: () => undefined,
    getAppliedSchemaVersion: () => 1,
    findWorkflowInstanceByCallbackTokenSync: () => null,
    WORKFLOW_SCHEMA_SQL: [],
    WORKFLOW_SCHEMA_VERSION: 1,
  },
});

// ── Mocked @agent-space/services ────────────────────────────────────────────

mock.module("@agent-space/services", {
  namedExports: {
    executeTransition: (
      instance: {
        currentState: string;
        context: Record<string, unknown>;
        history: unknown[];
        attempts: Record<string, number>;
        status: string;
      },
      event: { type: string; signal?: string; payload?: Record<string, unknown> },
      def: unknown,
    ) => {
      recordCall("executeTransition", [instance, event, def]);
      const newState = `${instance.currentState}__next`;
      const newInst = {
        ...instance,
        currentState: newState,
        status: "active" as const,
        context: { ...instance.context, ...(event.payload ?? {}) },
        attempts: { ...instance.attempts, t_mock: 1 },
        history: [
          ...instance.history,
          {
            idx: instance.history.length,
            fromState: instance.currentState,
            toState: newState,
            transitionId: "t_mock",
            eventName: event.signal ?? event.type,
            guardResults: {},
            actionResults: {},
          },
        ],
        updatedAt: nowIso(),
      };
      return {
        instance: newInst,
        result: {
          transitioned: true,
          toState: newState,
          guardsPassed: true,
          actionsRun: [],
          reason: null,
        },
      };
    },
    evaluateGuards: () => true,
    findTransition: () => null,
    findTransitionWithReason: () => ({ matched: false, reason: "no_transition" }),
    runPhaseActions: () => [],
    createInstanceId: () => "wfi_mock",
    bumpAttempt: () => undefined,
    setStore: () => undefined,
    getStore: () => null,
    createInMemoryWorkflowStore: () => ({}),
    InMemoryWorkflowStore: class {},
    resumeFromCallback: () => undefined,
    advanceAuto: () => undefined,
    createWorkflowInstance: () => undefined,
    GUARD_VM_TIMEOUT_MS: 200,
  },
});

// ── Imports (after mock.module registration) ─────────────────────────────────
//
// We dynamically import the actions module inside each test so the mock
// is in place before the module-under-test's static `import * from
// "@agent-space/db"` resolves. Node 22's mock.module replaces the
// module observed by *subsequent* imports of the specifier.

// ── Helpers ─────────────────────────────────────────────────────────────────

function findCall(name: string, predicate?: (c: MockCall) => boolean): MockCall | undefined {
  return state.calls.find(
    (c) => c.name === name && (!predicate || predicate(c)),
  );
}

// ── Test cases ──────────────────────────────────────────────────────────────

test.beforeEach(() => {
  state = freshState();
});

test("listWorkflowsAction calls listWorkflowDefinitionsSync + listWorkflowInstancesForWorkspaceSync", async () => {
  const { listWorkflowsAction } = await import("../actions.ts");
  const result = await listWorkflowsAction("ws_test");
  assert.deepEqual(result.definitions, []);
  assert.deepEqual(result.instances, []);

  const defsCall = findCall("listWorkflowDefinitionsSync");
  assert.ok(defsCall, "listWorkflowDefinitionsSync was called");
  assert.deepEqual(defsCall.args, ["ws_test"]);

  const instCall = findCall("listWorkflowInstancesForWorkspaceSync");
  assert.ok(instCall, "listWorkflowInstancesForWorkspaceSync was called");
  assert.deepEqual(instCall.args, ["ws_test"]);
});

test("createWorkflowDefinitionAction calls createWorkflowDefinitionSync and returns the record", async () => {
  const { createWorkflowDefinitionAction } = await import("../actions.ts");
  const defJson = {
    id: "thesis-36page",
    version: "1.0.0",
    label: "Thesis",
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      done: { id: "done", label: "Done" },
    },
    transitions: {
      t: {
        id: "t",
        from: "idle",
        to: "done",
        kind: "explicit",
        event: "finish",
      },
    },
  };

  const result = await createWorkflowDefinitionAction({
    workspaceId: "ws_test",
    name: "thesis-36page",
    version: 3,
    definitionJson: defJson,
  });

  assert.equal(result.workspaceId, "ws_test");
  assert.equal(result.name, "thesis-36page");
  assert.equal(result.version, 3);
  assert.deepEqual(result.definitionJson, defJson);

  const call = findCall("createWorkflowDefinitionSync");
  assert.ok(call, "createWorkflowDefinitionSync was called");
  const arg = call.args[0] as {
    workspaceId: string;
    name: string;
    version: number;
  };
  assert.equal(arg.workspaceId, "ws_test");
  assert.equal(arg.name, "thesis-36page");
  assert.equal(arg.version, 3);
});

test("createWorkflowDefinitionAction surfaces created record in listWorkflowsAction", async () => {
  const { createWorkflowDefinitionAction, listWorkflowsAction } = await import(
    "../actions.ts"
  );

  await createWorkflowDefinitionAction({
    workspaceId: "ws_test",
    name: "alpha",
    definitionJson: { id: "alpha", states: {}, transitions: {} },
  });

  const result = await listWorkflowsAction("ws_test");
  assert.equal(result.definitions.length, 1);
  assert.equal(result.definitions[0].name, "alpha");
  assert.equal(result.definitions[0].workspaceId, "ws_test");
});

test("advanceInstanceAction calls executeTransition + persists in transaction (P0-2)", async () => {
  const defJson = {
    id: "thesis-36page",
    version: "1.0.0",
    label: "Thesis",
    initialState: "idle",
    states: {
      idle: { id: "idle", label: "Idle" },
      done: { id: "done", label: "Done" },
    },
    transitions: {
      t: {
        id: "t",
        from: "idle",
        to: "done",
        kind: "explicit",
        event: "finish",
      },
    },
  };
  const defRec = makeDefRecord({
    workspaceId: "ws_test",
    name: "thesis-36page",
    definitionJson: defJson,
  });
  state.definitions.set(defRec.id, defRec);

  const instRec = makeInstRecord({
    workspaceId: "ws_test",
    definitionId: defRec.id,
    currentState: "idle",
  });
  state.instances.set(instRec.id, instRec);

  const { advanceInstanceAction } = await import("../actions.ts");
  const result = await advanceInstanceAction({
    workspaceId: "ws_test",
    instanceId: instRec.id,
    event: "finish",
    payload: { draftWordCount: 1500 },
  });

  assert.equal(result.transitioned, true);
  assert.equal(result.currentState, "idle__next");
  assert.equal(result.instanceId, instRec.id);

  // CRUD order: read instance → read definition → executeTransition → (transaction: update + history)
  const readInst = findCall(
    "readWorkflowInstanceSync",
    (c) => c.args[0] === instRec.id,
  );
  assert.ok(readInst, "readWorkflowInstanceSync called with the instance id");

  const readDef = findCall("readWorkflowDefinitionSync");
  assert.ok(readDef, "readWorkflowDefinitionSync called");

  const exec = findCall("executeTransition");
  assert.ok(exec, "executeTransition called");
  const execEvent = exec.args[1] as { type: string; signal: string; payload?: Record<string, unknown> };
  assert.equal(execEvent.type, "SIGNAL");
  assert.equal(execEvent.signal, "finish");
  assert.deepEqual(execEvent.payload, { draftWordCount: 1500 });

  // P0-2: writes wrapped in withTransaction
  assert.ok(state.txWraps >= 1, "withTransaction called at least once");
  const txCall = findCall("withTransaction");
  assert.ok(txCall);

  const update = findCall("updateWorkflowInstanceStateSync");
  assert.ok(update, "updateWorkflowInstanceStateSync called");
  const updateArg = update.args[1] as { status: string; currentState: string };
  assert.equal(updateArg.status, "active");
  assert.equal(updateArg.currentState, "idle__next");

  const history = findCall("recordWorkflowHistorySync");
  assert.ok(history, "recordWorkflowHistorySync called");
  const histInput = history.args[0] as {
    eventType: string;
    payloadJson: Record<string, unknown>;
  };
  assert.equal(histInput.eventType, "finish");
});

test("advanceInstanceAction enforces workspace isolation", async () => {
  const defRec = makeDefRecord({
    workspaceId: "ws_other",
    name: "other-workflow",
    definitionJson: { id: "x", states: {}, transitions: {} },
  });
  state.definitions.set(defRec.id, defRec);

  const instRec = makeInstRecord({
    workspaceId: "ws_other",
    definitionId: defRec.id,
  });
  state.instances.set(instRec.id, instRec);

  const { advanceInstanceAction } = await import("../actions.ts");
  await assert.rejects(
    () =>
      advanceInstanceAction({
        workspaceId: "ws_test",
        instanceId: instRec.id,
        event: "finish",
      }),
    /does not belong to workspace ws_test \(belongs to ws_other\)/,
  );
});

test("advanceInstanceAction rejects unknown instance", async () => {
  const { advanceInstanceAction } = await import("../actions.ts");
  await assert.rejects(
    () =>
      advanceInstanceAction({
        workspaceId: "ws_test",
        instanceId: "wfi_nonexistent",
        event: "finish",
      }),
    /WorkflowInstance not found: wfi_nonexistent/,
  );
});

test("advanceInstanceAction rejects unknown definition (FK sanity)", async () => {
  const instRec = makeInstRecord({
    workspaceId: "ws_test",
    definitionId: "wfd_missing",
  });
  state.instances.set(instRec.id, instRec);

  const { advanceInstanceAction } = await import("../actions.ts");
  await assert.rejects(
    () =>
      advanceInstanceAction({
        workspaceId: "ws_test",
        instanceId: instRec.id,
        event: "finish",
      }),
    /WorkflowDefinition not found: wfd_missing/,
  );
});

test("loadDefinitionDetail uses readWorkflowDefinitionSync + listWorkflowInstancesForDefinitionSync", async () => {
  const defRec = makeDefRecord({
    workspaceId: "ws_test",
    name: "alpha",
    definitionJson: { id: "alpha", states: {}, transitions: {} },
  });
  state.definitions.set(defRec.id, defRec);

  const instRec = makeInstRecord({
    workspaceId: "ws_test",
    definitionId: defRec.id,
  });
  state.instances.set(instRec.id, instRec);

  const { loadDefinitionDetail } = await import("../actions.ts");
  const data = loadDefinitionDetail(defRec.id);
  assert.ok(data.definition);
  assert.equal(data.definition?.name, "alpha");
  assert.equal(data.instances.length, 1);

  const readCall = findCall(
    "readWorkflowDefinitionSync",
    (c) => c.args[0] === defRec.id,
  );
  assert.ok(readCall, "readWorkflowDefinitionSync called with the right id");
  const listCall = findCall(
    "listWorkflowInstancesForDefinitionSync",
    (c) => c.args[0] === defRec.id,
  );
  assert.ok(listCall, "listWorkflowInstancesForDefinitionSync called");
});

test("loadDefinitionDetail returns null + empty list when definition is missing", async () => {
  const { loadDefinitionDetail } = await import("../actions.ts");
  const data = loadDefinitionDetail("wfd_missing");
  assert.equal(data.definition, null);
  assert.deepEqual(data.instances, []);
});

test("loadInstanceDetail uses readWorkflowInstanceSync + listWorkflowHistorySync", async () => {
  const defRec = makeDefRecord({
    workspaceId: "ws_test",
    name: "alpha",
    definitionJson: { id: "alpha", states: {}, transitions: {} },
  });
  state.definitions.set(defRec.id, defRec);

  const instRec = makeInstRecord({
    workspaceId: "ws_test",
    definitionId: defRec.id,
  });
  state.instances.set(instRec.id, instRec);

  state.history.push({
    id: "wfh_mock_1",
    workspaceId: "ws_test",
    instanceId: instRec.id,
    eventType: "START",
    fromState: null,
    toState: "idle",
    payloadJson: {},
    createdAt: nowIso(),
  });

  const { loadInstanceDetail } = await import("../actions.ts");
  const data = loadInstanceDetail(instRec.id);
  assert.ok(data.instance);
  assert.ok(data.definition);
  assert.equal(data.history.length, 1);

  const listHistCall = findCall(
    "listWorkflowHistorySync",
    (c) => c.args[0] === instRec.id,
  );
  assert.ok(listHistCall, "listWorkflowHistorySync called");
});

test("loadInstanceDetail returns null fields when instance is missing", async () => {
  const { loadInstanceDetail } = await import("../actions.ts");
  const data = loadInstanceDetail("wfi_missing");
  assert.equal(data.instance, null);
  assert.equal(data.definition, null);
  assert.deepEqual(data.history, []);
});