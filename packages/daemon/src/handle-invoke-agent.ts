// FSM P2-2 — Handler for "invoke-agent" task type.
//
// Stub agent invocation: echoes the prompt back with a fixed
// `[stub-echo] ` prefix and a synthetic model id. Real production
// would call the configured LLM provider (claude-code / openclaw /
// etc.) via the daemon's sub-process path; in the sandbox we keep
// the contract surface equivalent so callers and tests can develop
// against a stable dispatcher signature without external API costs.
//
// Validation:
//   - workspaceId  required
//   - agentId      required
//   - prompt       required (string, non-empty)

import type { TaskInput } from "./task-types.ts";

export interface InvokeAgentResult {
  agentId: string;
  agentResponse: string;
  model: "stub-echo";
  promptBytes: number;
}

export function handleInvokeAgent(input: TaskInput): InvokeAgentResult {
  if (!input.workspaceId) {
    throw new Error("invoke-agent task: workspaceId required");
  }
  if (!input.agentId || input.agentId.trim().length === 0) {
    throw new Error("invoke-agent task: agentId required");
  }
  if (typeof input.prompt !== "string" || input.prompt.length === 0) {
    throw new Error("invoke-agent task: prompt (non-empty string) required");
  }

  return {
    agentId: input.agentId,
    agentResponse: `[stub-echo ${input.agentId}] ${input.prompt}`,
    model: "stub-echo",
    promptBytes: Buffer.byteLength(input.prompt, "utf8"),
  };
}
