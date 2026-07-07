// L4.3 — page rendering tests.
//
// Verifies the view functions in views.ts produce the expected tree
// shape (links, tables, empty-state branches, history rendering).
//
// The page modules (page.tsx) are not exercised directly here — they
// are 5-line wrappers over loader + view. The loader is exercised in
// actions.test.ts (with mocked @agent-space/db). View is exercised
// here with fixed fixture data (no DB needed).
//
// Why no @testing-library/react: per L4.3 brief, the test repo does
// not have react/next installed (MEMORY #22/24 forbids npm install
// since it would clobber the manual @agent-space/* symlinks). The
// HNode tree is React.createElement-shaped, so test assertions look
// the same as @testing-library/jest-dom ones but operate on plain
// objects.

import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkflowsListView } from "../views.ts";
import { renderDefinitionDetailView } from "../views.ts";
import { renderInstanceDetailView } from "../views.ts";
import { findAll, textContent } from "../../html.ts";
import type {
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowHistoryRecord,
} from "@agent-space/db";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeDefinition(
  overrides: Partial<WorkflowDefinitionRecord> = {},
): WorkflowDefinitionRecord {
  return {
    id: overrides.id ?? "wfd_test_001",
    workspaceId: overrides.workspaceId ?? "ws_test",
    name: overrides.name ?? "test-workflow",
    version: overrides.version ?? 1,
    definitionJson: overrides.definitionJson ?? {
      id: "test-workflow",
      version: "1.0.0",
      label: "Test",
      initialState: "idle",
      states: { idle: { id: "idle", label: "Idle" } },
      transitions: {},
    },
    createdAt: overrides.createdAt ?? "2026-07-07T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-07T10:00:00.000Z",
  };
}

function makeInstance(
  overrides: Partial<WorkflowInstanceRecord> = {},
): WorkflowInstanceRecord {
  return {
    id: overrides.id ?? "wfi_test_001",
    workspaceId: overrides.workspaceId ?? "ws_test",
    definitionId: overrides.definitionId ?? "wfd_test_001",
    status: overrides.status ?? "active",
    currentState: overrides.currentState ?? "idle",
    contextJson: overrides.contextJson ?? {},
    attemptCount: overrides.attemptCount ?? 0,
    deadlineAt: overrides.deadlineAt ?? null,
    callbackToken: overrides.callbackToken ?? null,
    createdAt: overrides.createdAt ?? "2026-07-07T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-07T10:00:00.000Z",
  };
}

function makeHistory(
  overrides: Partial<WorkflowHistoryRecord> = {},
): WorkflowHistoryRecord {
  return {
    id: overrides.id ?? "wfh_test_001",
    workspaceId: overrides.workspaceId ?? "ws_test",
    instanceId: overrides.instanceId ?? "wfi_test_001",
    eventType: overrides.eventType ?? "START",
    fromState: overrides.fromState ?? null,
    toState: overrides.toState ?? "idle",
    payloadJson: overrides.payloadJson ?? {},
    createdAt: overrides.createdAt ?? "2026-07-07T10:00:01.000Z",
  };
}

// ── /workflows list view ────────────────────────────────────────────────────

test("list view: empty state shows empty messages, not tables", () => {
  const tree = renderWorkflowsListView({
    workspaceId: "ws_test",
    definitions: [],
    instances: [],
  });

  // Empty branches should be present
  const defsEmpty = findAll(
    tree,
    (n) => (n.props as Record<string, unknown>)["data-testid"] === "definitions-empty",
  );
  assert.equal(defsEmpty.length, 1);
  assert.equal(textContent(defsEmpty[0]), "No workflow definitions yet.");

  const instEmpty = findAll(
    tree,
    (n) => (n.props as Record<string, unknown>)["data-testid"] === "instances-empty",
  );
  assert.equal(instEmpty.length, 1);
  assert.equal(textContent(instEmpty[0]), "No workflow instances yet.");

  // No tables in empty state
  const tables = findAll(tree, (n) => n.tag === "table");
  assert.equal(tables.length, 0, "no tables when empty");
});

test("list view: with definitions, table rows have correct href", () => {
  const tree = renderWorkflowsListView({
    workspaceId: "ws_test",
    definitions: [
      makeDefinition({ id: "wfd_alpha", name: "alpha" }),
      makeDefinition({ id: "wfd_beta", name: "beta" }),
    ],
    instances: [],
  });

  // Exactly one table (definitions); instances are empty so they
  // render the empty <p>, not a table.
  const tables = findAll(tree, (n) => n.tag === "table");
  assert.equal(tables.length, 1, "only definitions table when instances empty");

  // Find link to alpha
  const links = findAll(tree, (n) => n.tag === "a");
  const alphaLink = links.find((l) => l.props.href === "/workflows/wfd_alpha");
  assert.ok(alphaLink, "alpha link present");
  assert.equal(textContent(alphaLink), "wfd_alpha");

  const betaLink = links.find((l) => l.props.href === "/workflows/wfd_beta");
  assert.ok(betaLink, "beta link present");
  assert.equal(textContent(betaLink), "wfd_beta");
});

test("list view: instance links point to /workflows/instances/[id]", () => {
  const tree = renderWorkflowsListView({
    workspaceId: "ws_test",
    definitions: [],
    instances: [
      makeInstance({ id: "wfi_one", currentState: "idle" }),
      makeInstance({ id: "wfi_two", currentState: "draft", status: "active" }),
    ],
  });

  const links = findAll(tree, (n) => n.tag === "a");
  const hrefs = links.map((l) => l.props.href);
  assert.ok(hrefs.includes("/workflows/instances/wfi_one"));
  assert.ok(hrefs.includes("/workflows/instances/wfi_two"));

  // Status is rendered in the status cell
  const statusSpans = findAll(
    tree,
    (n) =>
      typeof (n.props as Record<string, unknown>)["data-testid"] === "string" &&
      ((n.props as Record<string, unknown>)["data-testid"] as string).startsWith(
        "instance-status-",
      ),
  );
  assert.equal(statusSpans.length, 2);
});

test("list view: shows workspace id in the heading", () => {
  const tree = renderWorkflowsListView({
    workspaceId: "ws_workspace_xyz",
    definitions: [],
    instances: [],
  });
  const headings = findAll(tree, (n) => n.tag === "h1");
  assert.equal(headings.length, 1);
  assert.equal(textContent(headings[0]), "Workflows — workspace ws_workspace_xyz");
});

// ── /workflows/[definitionId] view ───────────────────────────────────────────

test("definition detail: not-found branch when definition is null", () => {
  const tree = renderDefinitionDetailView({
    definition: null,
    instances: [],
  });
  const notFound = findAll(
    tree,
    (n) => (n.props as Record<string, unknown>)["data-testid"] === "definition-not-found",
  );
  assert.equal(notFound.length, 1);
  assert.ok(textContent(notFound[0]).includes("Definition not found"));
});

test("definition detail: shows definition metadata + empty instances branch", () => {
  const def = makeDefinition({ id: "wfd_xyz", name: "xyz-workflow" });
  const tree = renderDefinitionDetailView({
    definition: def,
    instances: [],
  });

  const idCell = findAll(
    tree,
    (n) => (n.props as Record<string, unknown>)["data-testid"] === "definition-id",
  );
  assert.equal(idCell.length, 1);
  assert.equal(textContent(idCell[0]), "wfd_xyz");

  const emptyBranch = findAll(
    tree,
    (n) =>
      (n.props as Record<string, unknown>)["data-testid"] ===
      "definition-instances-empty",
  );
  assert.equal(emptyBranch.length, 1);
});

test("definition detail: instances rendered as links", () => {
  const def = makeDefinition({ id: "wfd_xyz" });
  const tree = renderDefinitionDetailView({
    definition: def,
    instances: [
      makeInstance({ id: "wfi_a", currentState: "idle" }),
      makeInstance({ id: "wfi_b", currentState: "done", status: "completed" }),
    ],
  });

  const links = findAll(tree, (n) => n.tag === "a");
  const hrefs = links.map((l) => l.props.href);
  assert.ok(hrefs.includes("/workflows/instances/wfi_a"));
  assert.ok(hrefs.includes("/workflows/instances/wfi_b"));
});

// ── /workflows/instances/[instanceId] view ───────────────────────────────────

test("instance detail: not-found branch when instance is null", () => {
  const tree = renderInstanceDetailView({
    instance: null,
    definition: null,
    history: [],
  });
  const notFound = findAll(
    tree,
    (n) => (n.props as Record<string, unknown>)["data-testid"] === "instance-not-found",
  );
  assert.equal(notFound.length, 1);
  assert.ok(textContent(notFound[0]).includes("Instance not found"));
});

test("instance detail: shows current state, status, attempts", () => {
  const inst = makeInstance({
    id: "wfi_aaa",
    currentState: "review",
    status: "waiting",
    attemptCount: 3,
  });
  const tree = renderInstanceDetailView({
    instance: inst,
    definition: makeDefinition(),
    history: [],
  });

  const stateNode = findAll(
    tree,
    (n) =>
      (n.props as Record<string, unknown>)["data-testid"] === "instance-current-state",
  );
  assert.equal(stateNode.length, 1);
  assert.equal(textContent(stateNode[0]), "review");

  const statusNode = findAll(
    tree,
    (n) => (n.props as Record<string, unknown>)["data-testid"] === "instance-status",
  );
  assert.equal(textContent(statusNode[0]), "waiting");

  const attemptsNode = findAll(
    tree,
    (n) =>
      (n.props as Record<string, unknown>)["data-testid"] === "instance-attempts",
  );
  assert.equal(textContent(attemptsNode[0]), "3");
});

test("instance detail: history rows in order", () => {
  const inst = makeInstance({ id: "wfi_aaa" });
  const tree = renderInstanceDetailView({
    instance: inst,
    definition: makeDefinition(),
    history: [
      makeHistory({
        id: "wfh_1",
        eventType: "START",
        fromState: null,
        toState: "idle",
        createdAt: "2026-07-07T10:00:01.000Z",
      }),
      makeHistory({
        id: "wfh_2",
        eventType: "start_outline",
        fromState: "idle",
        toState: "outline",
        createdAt: "2026-07-07T10:00:02.000Z",
      }),
      makeHistory({
        id: "wfh_3",
        eventType: "approve",
        fromState: "review",
        toState: "done",
        createdAt: "2026-07-07T10:00:03.000Z",
      }),
    ],
  });

  const rows = findAll(
    tree,
    (n) =>
      typeof (n.props as Record<string, unknown>)["data-testid"] === "string" &&
      ((n.props as Record<string, unknown>)["data-testid"] as string).startsWith(
        "history-row-",
      ),
  );
  assert.equal(rows.length, 3);
  assert.ok(textContent(rows[0]).includes("START"));
  assert.ok(textContent(rows[0]).includes("(start) → idle"));
  assert.ok(textContent(rows[1]).includes("start_outline"));
  assert.ok(textContent(rows[1]).includes("idle → outline"));
  assert.ok(textContent(rows[2]).includes("approve"));
  assert.ok(textContent(rows[2]).includes("review → done"));
});

test("instance detail: empty history shows empty message", () => {
  const inst = makeInstance({ id: "wfi_aaa" });
  const tree = renderInstanceDetailView({
    instance: inst,
    definition: makeDefinition(),
    history: [],
  });
  const empty = findAll(
    tree,
    (n) =>
      (n.props as Record<string, unknown>)["data-testid"] === "instance-history-empty",
  );
  assert.equal(empty.length, 1);
  assert.equal(textContent(empty[0]), "No history rows.");
});

test("instance detail: definition link points to /workflows/[definitionId]", () => {
  const inst = makeInstance({ id: "wfi_aaa", definitionId: "wfd_xyz" });
  const tree = renderInstanceDetailView({
    instance: inst,
    definition: makeDefinition({ id: "wfd_xyz" }),
    history: [],
  });
  const links = findAll(tree, (n) => n.tag === "a");
  const defLink = links.find((l) => l.props.href === "/workflows/wfd_xyz");
  assert.ok(defLink, "definition link present");
});