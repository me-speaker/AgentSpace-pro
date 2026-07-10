// FSM P2-2 — Unit tests for "invoke-agent" handler.
//
// Run with:
//   node --experimental-strip-types --test packages/daemon/src/handle-invoke-agent.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { handleInvokeAgent } from "./handle-invoke-agent.ts";

test("handleInvokeAgent: echoes prompt with stub prefix", () => {
  const r = handleInvokeAgent({
    workspaceId: "ws_a1",
    taskType: "invoke-agent",
    agentId: "as-manager",
    prompt: "summarize FSM Step 2",
  });
  assert.equal(r.agentId, "as-manager");
  assert.equal(r.model, "stub-echo");
  assert.equal(r.promptBytes, 20);
  assert.equal(
    r.agentResponse,
    "[stub-echo as-manager] summarize FSM Step 2",
  );
});

test("handleInvokeAgent: prompt byte length handles multibyte UTF-8", () => {
  const r = handleInvokeAgent({
    workspaceId: "ws",
    taskType: "invoke-agent",
    agentId: "agent",
    prompt: "中文测试", // 4 chars × 3 bytes = 12 bytes in UTF-8
  });
  assert.equal(r.promptBytes, 12);
});

test("handleInvokeAgent: rejects missing workspaceId", () => {
  assert.throws(
    () =>
      handleInvokeAgent({
        // @ts-expect-error
        workspaceId: "",
        taskType: "invoke-agent",
        agentId: "a",
        prompt: "p",
      }),
    /workspaceId required/,
  );
});

test("handleInvokeAgent: rejects missing agentId", () => {
  assert.throws(
    () =>
      handleInvokeAgent({
        workspaceId: "ws",
        taskType: "invoke-agent",
        // @ts-expect-error
        agentId: "",
        prompt: "p",
      }),
    /agentId required/,
  );
});

test("handleInvokeAgent: rejects empty prompt", () => {
  assert.throws(
    () =>
      handleInvokeAgent({
        workspaceId: "ws",
        taskType: "invoke-agent",
        agentId: "a",
        prompt: "",
      }),
    /prompt \(non-empty string\) required/,
  );
});

test("handleInvokeAgent: rejects non-string prompt", () => {
  assert.throws(
    () =>
      handleInvokeAgent({
        workspaceId: "ws",
        taskType: "invoke-agent",
        agentId: "a",
        // @ts-expect-error
        prompt: 123,
      }),
    /prompt \(non-empty string\) required/,
  );
});
