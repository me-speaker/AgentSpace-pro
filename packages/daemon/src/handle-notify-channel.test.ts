// FSM P2-2 — Unit tests for "notify-channel" handler.
//
// Run with:
//   node --experimental-strip-types --test packages/daemon/src/handle-notify-channel.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { handleNotifyChannel } from "./handle-notify-channel.ts";

// Helper: capture console.log for one call.
function captureConsoleLog(fn: () => unknown): string {
  const original = console.log;
  let captured = "";
  console.log = (...args: unknown[]) => {
    captured += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return captured;
}

test("handleNotifyChannel: returns deliveryId + logs message", () => {
  const logged = captureConsoleLog(() => {
    const r = handleNotifyChannel({
      workspaceId: "ws_n1",
      taskType: "notify-channel",
      channel: "im_default",
      message: "hello there",
    });
    assert.equal(r.channel, "im_default");
    assert.equal(r.bytesDelivered, 11);
    assert.ok(
      /^dlv_[a-z0-9-]+$/i.test(r.deliveryId),
      `unexpected deliveryId: ${r.deliveryId}`,
    );
  });
  assert.match(logged, /\[notify-channel\] ws_n1\/im_default/);
  assert.match(logged, /hello there/);
  assert.match(logged, /dlv_/);
});

test("handleNotifyChannel: different calls produce different deliveryIds", () => {
  const r1 = handleNotifyChannel({
    workspaceId: "ws",
    taskType: "notify-channel",
    channel: "c",
    message: "m1",
  });
  const r2 = handleNotifyChannel({
    workspaceId: "ws",
    taskType: "notify-channel",
    channel: "c",
    message: "m2",
  });
  assert.notEqual(r1.deliveryId, r2.deliveryId);
});

test("handleNotifyChannel: rejects missing workspaceId", () => {
  assert.throws(
    () =>
      handleNotifyChannel({
        // @ts-expect-error
        workspaceId: "",
        taskType: "notify-channel",
        channel: "c",
        message: "m",
      }),
    /workspaceId required/,
  );
});

test("handleNotifyChannel: rejects missing channel", () => {
  assert.throws(
    () =>
      handleNotifyChannel({
        workspaceId: "ws",
        taskType: "notify-channel",
        // @ts-expect-error
        channel: "",
        message: "m",
      }),
    /channel required/,
  );
});

test("handleNotifyChannel: rejects missing message", () => {
  assert.throws(
    () =>
      handleNotifyChannel({
        workspaceId: "ws",
        taskType: "notify-channel",
        channel: "c",
        // @ts-expect-error
        message: undefined,
      }),
    /message \(string\) required/,
  );
});
