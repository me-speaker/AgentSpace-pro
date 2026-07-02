// FSM 1.2 \u2014 services public surface
//
// Re-exports the workflow runtime + store so consumers can do:
//
//   import { createWorkflowInstance, executeTransition,
//            createInMemoryWorkflowStore, setStore } from "@agent-space/services";
//
// The runtime/store split lets test setups (and the L2 sandbox) run the
// FSM pure (in-memory) while a real production environment wires the
// Postgres-backed store via setStore() at boot.

export {
  // runtime core
  createInstanceId,
  createWorkflowInstance,
  executeTransition,
  evaluateGuards,
  runPhaseActions,
  findTransition,
  bumpAttempt,
  resumeFromCallback,
  advanceAuto,
  setStore,
  getStore,
  GUARD_VM_TIMEOUT_MS,
} from "./workflows/runtime.ts";

// store
export {
  InMemoryWorkflowStore,
  createInMemoryWorkflowStore,
} from "./workflows/store.ts";

export type {
  // store records
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowHistoryRecord,
  // store inputs
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  CreateWorkflowInstanceInput,
  UpdateWorkflowInstanceStateInput,
  RecordWorkflowHistoryInput,
  // store interface
  WorkflowStore,
} from "./workflows/store.ts";