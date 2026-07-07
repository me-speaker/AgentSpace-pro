// L4.4 — workflow subcommand router + types.
//
// Each subcommand is a (Command, ...) function that takes the args
// and prints output to stdout. The router parses argv and dispatches.
// Tests in workflow.test.ts exercise the CLI through the binary
// (spawning `node --experimental-strip-types src/bin.ts ...`) to
// validate the end-to-end pipeline.

import { listCommand } from "./commands/list.ts";
import { showCommand } from "./commands/show.ts";
import { createCommand } from "./commands/create.ts";
import { advanceCommand } from "./commands/advance.ts";
import { historyCommand } from "./commands/history.ts";

// ── Public types ────────────────────────────────────────────────────────────

export interface ParsedArgs {
  subcommand: string | null;
  positional: string[];
  flags: Record<string, string>;
  /** Original argv (for debugging). */
  raw: string[];
}

// ── Argv parser ─────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let subcommand: string | null = null;
  let sawSubcommand = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        const k = arg.slice(2, eq);
        const v = arg.slice(eq + 1);
        flags[k] = v;
      } else {
        const k = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[k] = next;
          i += 1;
        } else {
          // boolean flag, mark as "true"
          flags[k] = "true";
        }
      }
    } else if (!sawSubcommand) {
      subcommand = arg;
      sawSubcommand = true;
    } else {
      positional.push(arg);
    }
  }

  return { subcommand, positional, flags, raw: argv };
}

// ── Subcommand dispatcher ────────────────────────────────────────────────────

export interface SubcommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runWorkflowCommand(
  argv: string[],
): Promise<SubcommandResult> {
  const parsed = parseArgs(argv);
  if (parsed.subcommand === null) {
    return helpResult();
  }
  switch (parsed.subcommand) {
    case "list":
      return listCommand(parsed);
    case "show":
      return showCommand(parsed);
    case "create":
      return createCommand(parsed);
    case "advance":
      return advanceCommand(parsed);
    case "history":
      return historyCommand(parsed);
    case "help":
    case "--help":
    case "-h":
      return helpResult();
    default:
      return {
        exitCode: 1,
        stdout: "",
        stderr: `unknown subcommand: ${parsed.subcommand}\n${helpText()}`,
      };
  }
}

function helpResult(): SubcommandResult {
  return { exitCode: 0, stdout: helpText(), stderr: "" };
}

export function helpText(): string {
  return [
    "agent-space-workflow-test — workflow subcommands (L4.4 scaffold)",
    "",
    "Usage:",
    "  agent-space-workflow-test <subcommand> [args] [--flag value]",
    "",
    "Subcommands:",
    "  list [--workspace <id>]       List all definitions and instances in a workspace",
    "  show <instance-id>           Show instance details",
    "  create <name> --def <path>    Create a workflow definition from a JSON file",
    "  advance <instance-id> --event <name> [--payload <json>]",
    "                               Fire an event on an instance",
    "  history <instance-id>        Show instance history",
    "  help                         Print this help",
    "",
    "Flags:",
    "  --workspace <id>             Workspace ID (required for `list`)",
    "  --def <path>                 JSON file path with the definition body",
    "  --event <name>               Event name to fire",
    "  --payload <json>             Optional JSON payload, merged into context",
    "",
    "Env:",
    "  WORKFLOW_TEST_DB_PATH         SQLite file path (defaults to :memory:)",
  ].join("\n");
}

// ── Re-exports for tests ─────────────────────────────────────────────────────

export {
  listCommand,
  showCommand,
  createCommand,
  advanceCommand,
  historyCommand,
};