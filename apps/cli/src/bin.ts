// L4.4 — CLI entry point.
//
// `bin` field in package.json points here. Run with:
//   node --experimental-strip-types src/bin.ts list --workspace ws_x
//
// The CLI parses argv (skipping the first 2 elements which are node
// + script path), dispatches to the workflow subcommand router, and
// prints stdout/stderr. Exits with the subcommand's exit code.

import { runWorkflowCommand } from "./workflow.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const result = await runWorkflowCommand(argv);
  if (result.stdout) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) process.stdout.write("\n");
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) process.stderr.write("\n");
  }
  process.exit(result.exitCode);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});