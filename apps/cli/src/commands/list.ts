// L4.4 — `agent-space-workflow-test list` subcommand.
//
// Lists all definitions + instances in a workspace. Defaults to a
// hard-coded "default" workspace if --workspace is omitted (so the
// test e2e doesn't have to set up a workspace pre-seed).

import {
  listWorkflowDefinitionsSync,
  listWorkflowInstancesForWorkspaceSync,
} from "@agent-space/db";
import { renderTable } from "../output.ts";
import type { SubcommandResult, ParsedArgs } from "../workflow.ts";

export function listCommand(parsed: ParsedArgs): SubcommandResult {
  const workspaceId = parsed.flags.workspace ?? "default";

  const definitions = listWorkflowDefinitionsSync(workspaceId);
  const instances = listWorkflowInstancesForWorkspaceSync(workspaceId);

  const defLines: string[] = [];
  defLines.push(`Workspace: ${workspaceId}`);
  defLines.push("");
  defLines.push(`Definitions (${definitions.length}):`);
  defLines.push(
    renderTable(
      ["ID", "Name", "Version", "Updated"],
      definitions.map((d) => [
        d.id,
        d.name,
        String(d.version),
        d.updatedAt,
      ]),
    ),
  );

  defLines.push("");
  defLines.push(`Instances (${instances.length}):`);
  defLines.push(
    renderTable(
      ["ID", "Definition", "State", "Status", "Updated"],
      instances.map((i) => [
        i.id,
        i.definitionId,
        i.currentState,
        i.status,
        i.updatedAt,
      ]),
    ),
  );

  return {
    exitCode: 0,
    stdout: defLines.join("\n"),
    stderr: "",
  };
}