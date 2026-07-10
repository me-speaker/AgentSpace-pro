// FSM P2-2 — Handler for "notify-channel" task type.
//
// Stub delivery: logs the message and returns a synthetic deliveryId.
// Real production wires into the IM provider (Feishu / Slack / etc.)
// and persists delivery state; in the sandbox we surface the message
// via stdout so it can be tailed in test output.
//
// Validation:
//   - workspaceId  required
//   - channel      required (non-empty)
//   - message      required (string)

import type { TaskInput } from "./task-types.ts";

export interface NotifyChannelResult {
  deliveryId: string;
  channel: string;
  bytesDelivered: number;
}

/**
 * Generate a deliveryId that is unique per call (no external state).
 * Uses `crypto.randomUUID` when available; falls back to a Math.random
 * + timestamp mix so the handler stays import-clean across Node versions.
 */
function makeDeliveryId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) return `dlv_${cryptoRef.randomUUID()}`;
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e9).toString(36);
  return `dlv_${t}_${r}`;
}

export function handleNotifyChannel(input: TaskInput): NotifyChannelResult {
  if (!input.workspaceId) {
    throw new Error("notify-channel task: workspaceId required");
  }
  if (!input.channel || input.channel.trim().length === 0) {
    throw new Error("notify-channel task: channel required");
  }
  if (typeof input.message !== "string") {
    throw new Error("notify-channel task: message (string) required");
  }

  const deliveryId = makeDeliveryId();
  // eslint-disable-next-line no-console
  console.log(
    `[notify-channel] ${input.workspaceId}/${input.channel} ${deliveryId}: ${input.message}`,
  );
  return {
    deliveryId,
    channel: input.channel,
    bytesDelivered: Buffer.byteLength(input.message, "utf8"),
  };
}
