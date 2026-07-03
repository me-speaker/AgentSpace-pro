// FSM L4.2 — Scheduled Workflow record + in-memory registry
//
// A ScheduledWorkflow is the per-cron binding between a workspace, a
// workflow definition, and a cron expression. Each tick of the
// scheduler iterates the registry and fires `handleWorkflowTask` for
// every enabled workflow whose cron pattern is currently due.
//
// The registry is intentionally process-local: in production this
// would be backed by the `scheduled_task` table + a per-runtime
// coordination layer. For the L4.2 close-out, an in-memory Map is
// sufficient — it lets us exercise the cron math + tick loop without
// a DB-backed scheduler table.

import type { WorkflowInstance } from "@agent-space/domain/workflows";

export interface ScheduledWorkflow {
  id: string;
  workspaceId: string;
  definitionId: string;
  /** 5-field cron expression. Only "* * * * *" and "*<slash>N * * * *" supported. */
  cronExpr: string;
  enabled: boolean;
  /** Initial contextJson for new instances the scheduler creates. */
  inputJson: Record<string, unknown>;
  /** ISO-8601 timestamp of the last successful fire, or null. */
  lastFiredAt: string | null;
}

const _registry = new Map<string, ScheduledWorkflow>();

export function registerScheduledWorkflow(wf: ScheduledWorkflow): void {
  _registry.set(wf.id, wf);
}

export function unregisterScheduledWorkflow(id: string): boolean {
  return _registry.delete(id);
}

export function getScheduledWorkflow(id: string): ScheduledWorkflow | null {
  return _registry.get(id) ?? null;
}

export function listScheduledWorkflows(): ScheduledWorkflow[] {
  return Array.from(_registry.values());
}

export function clearScheduledWorkflows(): void {
  _registry.clear();
}

export function setLastFiredAt(id: string, timestamp: string): void {
  const wf = _registry.get(id);
  if (wf) {
    _registry.set(id, { ...wf, lastFiredAt: timestamp });
  }
}

// Suppress unused warning for the type import (used by callers, not here).
type _UnusedInstance = WorkflowInstance;
