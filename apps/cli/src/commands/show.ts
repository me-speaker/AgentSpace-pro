// L4.4 — `agent-space-workflow-test show <instance-id>` subcommand.

import {
  readWorkflowInstanceSync,
  readWorkflowDefinitionSync,
} from "@agent-space/db";
import { renderKvBlock } from "../output.ts";
import type { SubcommandResult, ParsedArgs } from "../workflow.ts";

export function showCommand(parsed: ParsedArgs): SubcommandResult {
  const instanceId = parsed.positional[0];
  if (!instanceId) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "show: missing <instance-id> argument",
    };
  }
  const inst = readWorkflowInstanceSync(instanceId);
  if (!inst) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `show: instance not found: ${instanceId}`,
    };
  }
  const def = readWorkflowDefinitionSync(inst.definitionId);

  const body = renderKvBlock([
    ["id", inst.id],
    ["workspace", inst.workspaceId],
    ["definition", def ? `${def.name} (${def.id})` : inst.definitionId],
    ["state", inst.currentState],
    ["status", inst.status],
    ["attempts", inst.attemptCount],
    ["deadline", inst.deadlineAt],
    ["callback", inst.callbackToken],
    ["created", inst.createdAt],
    ["updated", inst.updatedAt],
    ["context", inst.contextJson],
  ]);

  return { exitCode: 0, stdout: body, stderr: "" };
}