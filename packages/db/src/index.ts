// FSM L2 close-out — @agent-space/db public surface
//
// Re-exports the L2 DB-backed WorkflowStore CRUD + getDatabase so
// persistence.test.ts and downstream consumers can:
//
//   import { getDatabase, createWorkflowDefinitionSync, ... } from "@agent-space/db";

export { getDatabase, resetDatabaseForTests, getAppliedSchemaVersion, withTransaction } from "./workflows/database.ts";

export {
  // Definition CRUD
  createWorkflowDefinitionSync,
  readWorkflowDefinitionSync,
  listWorkflowDefinitionsSync,
  updateWorkflowDefinitionSync,
  deleteWorkflowDefinitionSync,
  // Instance CRUD
  createWorkflowInstanceSync,
  readWorkflowInstanceSync,
  listWorkflowInstancesForDefinitionSync,
  listWorkflowInstancesForWorkspaceSync,
  updateWorkflowInstanceStateSync,
  findWorkflowInstanceByCallbackTokenSync,
  // History
  recordWorkflowHistorySync,
  listWorkflowHistorySync,
} from "./workflows/store.ts";

export {
  WORKFLOW_SCHEMA_SQL,
  WORKFLOW_SCHEMA_VERSION,
} from "./workflows/schema.ts";

export type {
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowHistoryRecord,
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  CreateWorkflowInstanceInput,
  UpdateWorkflowInstanceStateInput,
  RecordWorkflowHistoryInput,
} from "./workflows/store.ts";
