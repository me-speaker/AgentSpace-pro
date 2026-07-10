// FSM P2-2 — Daemon lifecycle + dispatchTask.
//
// Real production daemon polls agent_task_queue and dispatches each
// task to a per-type handler. For the test repo we keep the
// lifecycle scaffold minimal: start/stop a setInterval that
// demonstrates the polling shape, with the actual queue reading
// left as a no-op. The P2-1 scheduler (in
// @agent-space/services/schedules) is the actual cron-driven trigger.
//
// After P2-2 the dispatchTask switch covers 5 task types:
//   workflow        (L4.1)
//   noop            (L4.1)
//   update-doc      (P2-2)
//   notify-channel  (P2-2)
//   invoke-agent    (P2-2)

import { handleWorkflowTask } from "./handle-workflow-task.ts";
import { handleUpdateDoc } from "./handle-update-doc.ts";
import { handleNotifyChannel } from "./handle-notify-channel.ts";
import { handleInvokeAgent } from "./handle-invoke-agent.ts";
import type { TaskInput, TaskOutput } from "./task-types.ts";

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _tickIntervalMs = 5000;

/**
 * Start the daemon's task-queue polling loop. Calling this twice is
 * a no-op (the second call returns immediately).
 */
export function startDaemon(opts?: { tickIntervalMs?: number }): void {
  if (_intervalId !== null) return;
  _tickIntervalMs = opts?.tickIntervalMs ?? 5000;
  _intervalId = setInterval(() => {
    pollTaskQueue();
  }, _tickIntervalMs);
}

/**
 * Stop the daemon's polling loop. Safe to call when not started.
 */
export function stopDaemon(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

export function isDaemonRunning(): boolean {
  return _intervalId !== null;
}

/**
 * Fake task queue polling — placeholder. The real production daemon
 * would `SELECT * FROM agent_task_queue WHERE status = 'queued' LIMIT N`
 * and dispatch each row. For L4.1 the queue is empty; cron-driven
 * workflow triggers live in @agent-space/services/schedules.
 */
function pollTaskQueue(): void {
  // no-op
}

/**
 * Direct dispatch entry point — bypasses the polling loop. Useful
 * for tests and ad-hoc invocations. Each handler is wrapped in
 * try/catch so a bad task input returns a TaskOutput with
 * `ok:false` and an error string instead of throwing.
 */
export function dispatchTask(input: TaskInput): TaskOutput {
  try {
    switch (input.taskType) {
      case "workflow": {
        if (!input.definitionId) {
          return {
            ok: false,
            taskType: input.taskType,
            error: "definitionId required for workflow task",
          };
        }
        const result = handleWorkflowTask({
          workspaceId: input.workspaceId,
          definitionId: input.definitionId,
          instanceId: input.instanceId,
          channelName: input.channelName,
          contactId: input.contactId,
          inputJson: input.inputJson,
          event: input.event,
        });
        return { ok: true, taskType: input.taskType, result };
      }
      case "update-doc": {
        const result = handleUpdateDoc(input);
        return { ok: true, taskType: input.taskType, result };
      }
      case "notify-channel": {
        const result = handleNotifyChannel(input);
        return { ok: true, taskType: input.taskType, result };
      }
      case "invoke-agent": {
        const result = handleInvokeAgent(input);
        return { ok: true, taskType: input.taskType, result };
      }
      case "noop":
        return { ok: true, taskType: input.taskType };
    }
  } catch (err) {
    return {
      ok: false,
      taskType: input.taskType,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
