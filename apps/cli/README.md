# apps/cli — L4.4 scaffold

Minimal CLI for workflow inspection + advance. Designed to mirror the
prod CLI surface (subset only).

## Subcommands

```
agent-space-workflow-test list [--workspace <id>]
agent-space-workflow-test show <instance-id>
agent-space-workflow-test create <name> --def <path> [--workspace <id>] [--version <n>]
agent-space-workflow-test advance <instance-id> --event <name> [--payload <json>] [--workspace <id>]
agent-space-workflow-test history <instance-id>
agent-space-workflow-test help
```

## Running

```sh
node --experimental-strip-types apps/cli/src/bin.ts list --workspace ws_test
```

Or install globally (skipping `npm install` to preserve symlinks):

```sh
# Make the bin entry executable + add to PATH manually:
node --experimental-strip-types $(pwd)/apps/cli/src/bin.ts list --workspace ws_test
```

In prod (per L4.4 brief), the bin entry would be invoked through a
compiled wrapper (`tsx`, `esbuild`, or post-install transpile). The
L4.4 scaffold keeps `node --experimental-strip-types` so the test
repo stays build-free.

## Tests

```sh
node --experimental-strip-types --test apps/cli/src/workflow.test.ts
```

Or:

```sh
npm --prefix apps/cli run test:cli
```

## Env

- `WORKFLOW_TEST_DB_PATH` — SQLite file path (defaults to `:memory:`).
  The CLI inherits this from the parent shell, so e2e tests set it
  before spawning the binary.

## Persistence

The CLI's `advance` subcommand uses the same `executeTransition` +
`withTransaction(update + recordHistory)` path as the L4.1 daemon.
This means history rows created via the CLI are indistinguishable
from rows created via the daemon — the prod scheduler can mix the
two safely.

## What's NOT here (intentionally)

- **No `create-instance` subcommand.** Instances are created by the
  daemon (L4.1) or scheduler (L4.2) in prod, not by hand via CLI.
  Tests pre-seed instances via `createWorkflowInstanceSync` in a
  helper sub-process.
- **No `--workspace` enforcement on `show`/`advance`/`history`.**
  These read by instance-id directly; workspace isolation is
  enforced inside `advanceInstance` (rejects cross-workspace calls).
- **No JSON output flag.** The `list` / `show` / `history` output is
  human-readable text. A `--json` flag is a trivial addition (the
  `renderJson` helper in `src/output.ts` is already there).
- **No shell completion.** Out of scope for L4.4.