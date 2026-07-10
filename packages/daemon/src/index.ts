// FSM P2-2 — @agent-space/daemon-test public surface
//
// Re-exports the workflow task handler + daemon lifecycle + the P2-2
// non-workflow handlers so consumers can do:
//
//   import {
//     handleWorkflowTask,
//     handleUpdateDoc, handleNotifyChannel, handleInvokeAgent,
//     startDaemon, stopDaemon, dispatchTask,
//   } from "@agent-space/daemon-test";
//
// The package is a self-built minimal daemon runtime for the test
// repo; the prod daemon lives in /home/speaker/AgentSpace/packages/daemon
// and is NOT touched from this package.

export { handleWorkflowTask } from "./handle-workflow-task.ts";
export type {
  HandleWorkflowTaskInput,
  HandleWorkflowTaskResult,
} from "./handle-workflow-task.ts";

export { handleUpdateDoc } from "./handle-update-doc.ts";
export type { UpdateDocResult } from "./handle-update-doc.ts";

export { handleNotifyChannel } from "./handle-notify-channel.ts";
export type { NotifyChannelResult } from "./handle-notify-channel.ts";

export { handleInvokeAgent } from "./handle-invoke-agent.ts";
export type { InvokeAgentResult } from "./handle-invoke-agent.ts";

export {
  startDaemon,
  stopDaemon,
  isDaemonRunning,
  dispatchTask,
} from "./daemon.ts";

export type {
  TaskType,
  TaskInput,
  TaskOutput,
  WorkflowEventSpec,
} from "./task-types.ts";
