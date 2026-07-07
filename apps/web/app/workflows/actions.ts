// L4.3 — server actions for the /workflows pages.
//
// `"use server"` marks these as Next.js server actions (the test repo
// doesn't actually run next dev — see README — but the marker is the
// contract the prod deploy would rely on).
//
// Each action delegates to a loader function in ./loader.ts. Loaders
// are pure data-access + daemon-mirror logic, kept separate so they
// can be unit-tested without going through the Next.js action runtime.

"use server";

import {
  loadWorkflowsList,
  loadDefinitionDetail,
  loadInstanceDetail,
  createWorkflowDefinition,
  advanceInstance,
  type CreateWorkflowInput,
  type AdvanceInstanceInput,
  type AdvanceInstanceResult,
} from "./loader.ts";
import type {
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
} from "@agent-space/db";

// ── Query actions ────────────────────────────────────────────────────────────

export async function listWorkflowsAction(
  workspaceId: string,
): Promise<{
  definitions: WorkflowDefinitionRecord[];
  instances: WorkflowInstanceRecord[];
}> {
  const data = loadWorkflowsList(workspaceId);
  return {
    definitions: data.definitions,
    instances: data.instances,
  };
}

// ── Mutation actions ────────────────────────────────────────────────────────

export async function createWorkflowDefinitionAction(
  input: CreateWorkflowInput,
): Promise<WorkflowDefinitionRecord> {
  return createWorkflowDefinition(input);
}

export async function advanceInstanceAction(
  input: AdvanceInstanceInput,
): Promise<AdvanceInstanceResult> {
  return advanceInstance(input);
}

// ── Re-exports so test files can avoid an extra hop through loader.ts ───────

export {
  loadDefinitionDetail,
  loadInstanceDetail,
};
export type {
  CreateWorkflowInput,
  AdvanceInstanceInput,
  AdvanceInstanceResult,
};