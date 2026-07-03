// FSM L4.1 — @agent-space/daemon-test public surface
//
// Re-exports the workflow task handler + daemon lifecycle so consumers
// can do:
//
//   import { handleWorkflowTask, startDaemon, stopDaemon,
//            dispatchTask } from "@agent-space/daemon-test";
//
// The package is a self-built minimal daemon runtime for the test
// repo; the prod daemon lives in /home/speaker/AgentSpace/packages/daemon
// and is NOT touched from this package.

export { handleWorkflowTask } from "./handle-workflow-task.ts";
export type {
  HandleWorkflowTaskInput,
  HandleWorkflowTaskResult,
} from "./handle-workflow-task.ts";

export { startDaemon, stopDaemon, isDaemonRunning, dispatchTask } from "./daemon.ts";

export type { TaskType, TaskInput, TaskOutput, WorkflowEventSpec } from "./task-types.ts";
