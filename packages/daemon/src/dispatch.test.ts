// FSM P2-2 — Dispatch routing test.
//
// Verifies that dispatchTask routes by taskType to the right handler
// and that error inputs return ok:false + an error string instead of
// throwing. Also verifies that the smoke E2E pipeline
// (update-doc → notify-channel → invoke-agent) works in sequence
// for one workspace.
//
// Run with:
//   node --experimental-strip-types --test packages/daemon/src/dispatch.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { dispatchTask } from "./daemon.ts";
import type { TaskOutput } from "./task-types.ts";

test.beforeEach(() => {
  const docs = path.join(".data", "docs");
  if (fs.existsSync(docs)) {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});

test.after(() => {
  const docs = path.join(".data", "docs");
  if (fs.existsSync(docs)) {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});

test("dispatchTask routes update-doc through handleUpdateDoc", () => {
  const out = dispatchTask({
    workspaceId: "ws_d1",
    taskType: "update-doc",
    docId: "readme",
    content: "hello",
    format: "text",
  });
  assert.ok(out.ok, "ok true");
  assert.equal(out.taskType, "update-doc");
  const r = out.result as { bytesWritten: number; path: string };
  assert.equal(r.bytesWritten, 5);
  assert.ok(r.path.endsWith("readme.text"));
});

test("dispatchTask routes notify-channel through handleNotifyChannel", () => {
  // Suppress console.log for this test
  const original = console.log;
  let captured = "";
  console.log = (...args: unknown[]) => {
    captured += args.map((a) => String(a)).join(" ");
  };
  try {
    const out = dispatchTask({
      workspaceId: "ws_d2",
      taskType: "notify-channel",
      channel: "im_default",
      message: "P2-2 dispatch ok",
    });
    assert.ok(out.ok);
    assert.equal(out.taskType, "notify-channel");
    const r = out.result as { deliveryId: string; channel: string };
    assert.equal(r.channel, "im_default");
    assert.ok(/^dlv_/.test(r.deliveryId));
    assert.match(captured, /P2-2 dispatch ok/);
  } finally {
    console.log = original;
  }
});

test("dispatchTask routes invoke-agent through handleInvokeAgent", () => {
  const out = dispatchTask({
    workspaceId: "ws_d3",
    taskType: "invoke-agent",
    agentId: "as-manager",
    prompt: "summarize P2-2",
  });
  assert.ok(out.ok);
  assert.equal(out.taskType, "invoke-agent");
  const r = out.result as { agentResponse: string; model: string };
  assert.equal(r.model, "stub-echo");
  assert.equal(r.agentResponse, "[stub-echo as-manager] summarize P2-2");
});

test("dispatchTask (noop) returns ok with no result", () => {
  const out = dispatchTask({
    workspaceId: "ws_d4",
    taskType: "noop",
  });
  assert.ok(out.ok);
  assert.equal(out.taskType, "noop");
  assert.equal(out.result, undefined);
});

test("dispatchTask catches handler errors and returns ok:false", () => {
  const out: TaskOutput = dispatchTask({
    workspaceId: "ws_d5",
    taskType: "update-doc",
    // @ts-expect-error — missing docId / content to trigger handler throw
    docId: "",
    content: "",
  });
  assert.equal(out.ok, false);
  assert.equal(out.taskType, "update-doc");
  assert.match(out.error ?? "", /docId required/);
});

test("dispatchTask (workflow) requires definitionId", () => {
  const out = dispatchTask({
    workspaceId: "ws_d6",
    taskType: "workflow",
    // definitionId missing on purpose
  });
  assert.equal(out.ok, false);
  assert.equal(out.taskType, "workflow");
  assert.match(out.error ?? "", /definitionId required/);
});

test("dispatchTask end-to-end pipeline: write doc → notify → invoke", () => {
  const ws = "ws_pipeline";

  // 1. update-doc
  const step1 = dispatchTask({
    workspaceId: ws,
    taskType: "update-doc",
    docId: "thesis-36page",
    content: "# Outline\n\n## Chapter 1",
    format: "markdown",
  });
  assert.ok(step1.ok);

  // 2. notify-channel (suppress log)
  const original = console.log;
  console.log = () => {};
  try {
    const step2 = dispatchTask({
      workspaceId: ws,
      taskType: "notify-channel",
      channel: "im_default",
      message: "thesis-36page outline written",
    });
    assert.ok(step2.ok);
  } finally {
    console.log = original;
  }

  // 3. invoke-agent
  const step3 = dispatchTask({
    workspaceId: ws,
    taskType: "invoke-agent",
    agentId: "as-manager",
    prompt: "validate outline of thesis-36page",
  });
  assert.ok(step3.ok);

  // file from step 1 should exist
  const expectedPath = path.join(".data", "docs", ws, "thesis-36page.md");
  assert.ok(
    fs.existsSync(expectedPath),
    `expected file at ${expectedPath}`,
  );
});
