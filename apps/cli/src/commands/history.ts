// L4.4 — `agent-space-workflow-test history <instance-id>` subcommand.

import {
  readWorkflowInstanceSync,
  listWorkflowHistorySync,
} from "@agent-space/db";
import { renderTable } from "../output.ts";
import type { SubcommandResult, ParsedArgs } from "../workflow.ts";

export function historyCommand(parsed: ParsedArgs): SubcommandResult {
  const instanceId = parsed.positional[0];
  if (!instanceId) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "history: missing <instance-id> argument",
    };
  }
  const inst = readWorkflowInstanceSync(instanceId);
  if (!inst) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `history: instance not found: ${instanceId}`,
    };
  }
  const history = listWorkflowHistorySync(instanceId);
  const body = renderTable(
    ["When", "Event", "From", "To"],
    history.map((h) => [
      h.createdAt,
      h.eventType,
      h.fromState ?? "(start)",
      h.toState ?? "(none)",
    ]),
  );
  return {
    exitCode: 0,
    stdout: `History of ${inst.id} (${history.length} rows):\n${body}`,
    stderr: "",
  };
}