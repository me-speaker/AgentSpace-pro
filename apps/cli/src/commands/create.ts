// L4.4 — `agent-space-workflow-test create <name> --def <path>` subcommand.
//
// Reads a JSON file from disk, creates a WorkflowDefinition row.

import { readFileSync } from "node:fs";
import { createWorkflowDefinitionSync } from "@agent-space/db";
import type { SubcommandResult, ParsedArgs } from "../workflow.ts";

export function createCommand(parsed: ParsedArgs): SubcommandResult {
  const name = parsed.positional[0];
  if (!name) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "create: missing <name> argument",
    };
  }
  const defPath = parsed.flags.def;
  if (!defPath) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "create: missing --def <path> flag (JSON file with the definition body)",
    };
  }
  const workspaceId = parsed.flags.workspace ?? "default";
  const versionStr = parsed.flags.version;
  const version = versionStr !== undefined ? Number(versionStr) : undefined;

  let raw: string;
  try {
    raw = readFileSync(defPath, "utf8");
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `create: failed to read ${defPath}: ${(err as Error).message}`,
    };
  }

  let definitionJson: Record<string, unknown>;
  try {
    const parsed2 = JSON.parse(raw);
    if (
      typeof parsed2 !== "object" ||
      parsed2 === null ||
      Array.isArray(parsed2)
    ) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "create: definition JSON must be a JSON object",
      };
    }
    definitionJson = parsed2 as Record<string, unknown>;
  } catch (err) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `create: invalid JSON in ${defPath}: ${(err as Error).message}`,
    };
  }

  const rec = createWorkflowDefinitionSync({
    workspaceId,
    name,
    version,
    definitionJson,
  });

  return {
    exitCode: 0,
    stdout: `created definition ${rec.id}\n  name: ${rec.name}\n  workspace: ${rec.workspaceId}\n  version: ${rec.version}`,
    stderr: "",
  };
}