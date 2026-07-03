// FSM L4.1 — Daemon lifecycle (minimal)
//
// The real production daemon polls agent_task_queue and dispatches each
// task to a handler (workflow, notify-channel, invoke-agent, etc.).
// For L4.1 close-out we keep the lifecycle scaffold minimal: start/stop
// a setInterval that demonstrates the polling shape, with the actual
// queue reading left as a no-op. The L4.2 scheduler (in
// @agent-space/services) is the actual cron-driven trigger.
//
// The lifecycle is intentionally simple — no graceful drain, no health
// endpoint, no metrics. The L4.6 close-out will decide whether to
// expand this. For now: startDaemon() is idempotent, stopDaemon() is
// safe to call multiple times.

import { handleWorkflowTask } from "./handle-workflow-task.ts";
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
 * and dispatch each row. For the L4.1 close-out the queue is empty;
 * cron-driven workflow triggers live in @agent-space/services/schedules
 * (added in L4.2).
 */
function pollTaskQueue(): void {
  // no-op for L4.1
}

/**
 * Direct dispatch entry point — bypasses the polling loop. Useful for
 * tests and ad-hoc invocations.
 */
export function dispatchTask(input: TaskInput): TaskOutput {
  try {
    if (input.taskType === "workflow") {
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
    // noop — return ok with no result.
    return { ok: true, taskType: input.taskType };
  } catch (err) {
    return {
      ok: false,
      taskType: input.taskType,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
