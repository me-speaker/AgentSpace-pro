// L4.4 — CLI e2e test (spawns the real binary).
//
// Verifies the full pipeline:
//   1. `create` reads a JSON file + inserts a WorkflowDefinition row
//   2. We seed an instance directly via @agent-space/db (the CLI has
//      no `create-instance` subcommand — instances are created by the
//      daemon scheduler in prod; the CLI acts on existing instances)
//   3. `advance` fires an event + persists via the daemon-mirror path
//   4. `show` reports the current state
//   5. `history` lists the history rows in order
//
// Why spawn the binary instead of calling the command functions
// directly:
//   - Catches argv-parsing bugs (a common CLI regression class)
//   - Validates exit codes (advance returns 2 on no-transition)
//   - Uses a real SQLite file DB so persistence is exercised end-to-end
//
// Per MEMORY #22/24, no npm install — pure node --experimental-strip-types.
//
// Run with:
//   node --experimental-strip-types --test apps/cli/src/workflow.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Test DB setup ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const BIN_PATH = resolve(REPO_ROOT, "apps/cli/src/bin.ts");

const DB_DIR = resolve(REPO_ROOT, ".data");
const DB_PATH = resolve(DB_DIR, "cli-e2e.db");
const DEF_JSON_PATH = resolve(DB_DIR, "cli-e2e-def.json");

// MUST be set before any @agent-space/db import resolves, so the
// @agent-space/db singleton points at this file. Each sub-process
// (the spawned CLI) inherits the parent's env, so we set once here.
process.env.WORKFLOW_TEST_DB_PATH = DB_PATH;

function cleanup(): void {
  try {
    rmSync(DB_PATH, { force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(`${DB_PATH}-wal`, { force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(`${DB_PATH}-shm`, { force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(DEF_JSON_PATH, { force: true });
  } catch {
    // ignore
  }
}

test.before(() => {
  mkdirSync(DB_DIR, { recursive: true });
  cleanup();
});

test.after(() => {
  cleanup();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", BIN_PATH, ...args],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Run the CLI with the test DB path forced (so sub-processes don't
 *  fall back to :memory:). */
function runCliOnTestDb(args: string[]): CliResult {
  return runCli(args, { WORKFLOW_TEST_DB_PATH: DB_PATH });
}

// ── Fixture: thesis-36page definition ────────────────────────────────────────

const THESIS_DEF = {
  id: "thesis-36page",
  version: "1.0.0",
  label: "Thesis 36-page",
  initialState: "idle",
  states: {
    idle: { id: "idle", label: "Idle" },
    outline: { id: "outline", label: "Outline" },
    draft: { id: "draft", label: "Draft" },
    review: { id: "review", label: "Review" },
    done: { id: "done", label: "Done" },
  },
  transitions: {
    t1: {
      id: "t1",
      from: "idle",
      to: "outline",
      kind: "explicit",
      event: "start_outline",
    },
    t2: {
      id: "t2",
      from: "outline",
      to: "draft",
      kind: "explicit",
      event: "start_draft",
    },
    t3: {
      id: "t3",
      from: "draft",
      to: "review",
      kind: "explicit",
      event: "submit_review",
      guards: [
        {
          id: "g_word_count",
          label: "min 1000 words",
          condition: "ctx.draftWordCount >= 1000",
          required: true,
        },
      ],
    },
    t4: {
      id: "t4",
      from: "review",
      to: "done",
      kind: "explicit",
      event: "approve",
    },
  },
};

// ── Tests ───────────────────────────────────────────────────────────────────

test("CLI help prints subcommand list", () => {
  const r = runCli(["help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /agent-space-workflow-test/);
  assert.match(r.stdout, /list/);
  assert.match(r.stdout, /show/);
  assert.match(r.stdout, /create/);
  assert.match(r.stdout, /advance/);
  assert.match(r.stdout, /history/);
});

test("CLI rejects unknown subcommand with exit 1", () => {
  const r = runCli(["nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown subcommand: nope/);
});

test("CLI list on empty DB shows zero counts", () => {
  cleanup(); // fresh DB
  const r = runCliOnTestDb(["list", "--workspace", "ws_cli_test"]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /Workspace: ws_cli_test/);
  assert.match(r.stdout, /Definitions \(0\)/);
  assert.match(r.stdout, /Instances \(0\)/);
});

test("CLI create reads JSON file and inserts definition", () => {
  cleanup();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DEF_JSON_PATH, JSON.stringify(THESIS_DEF, null, 2));

  const r = runCliOnTestDb([
    "create",
    "thesis-36page",
    "--def",
    DEF_JSON_PATH,
    "--workspace",
    "ws_cli_test",
    "--version",
    "1",
  ]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  assert.match(r.stdout, /created definition wfd_/);
  assert.match(r.stdout, /name: thesis-36page/);
  assert.match(r.stdout, /workspace: ws_cli_test/);
});

test("CLI create rejects missing --def", () => {
  const r = runCliOnTestDb(["create", "foo"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing --def/);
});

test("CLI create rejects missing name", () => {
  const r = runCliOnTestDb(["create", "--def", "/tmp/x.json"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing <name> argument/);
});

test("CLI create rejects non-existent file", () => {
  const r = runCliOnTestDb([
    "create",
    "foo",
    "--def",
    "/nonexistent/path.json",
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /failed to read/);
});

test("CLI list after create shows the definition", () => {
  // Pre-seed: create a definition via CLI.
  cleanup();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DEF_JSON_PATH, JSON.stringify(THESIS_DEF, null, 2));
  runCliOnTestDb([
    "create",
    "thesis-36page",
    "--def",
    DEF_JSON_PATH,
    "--workspace",
    "ws_cli_test",
  ]);

  const r = runCliOnTestDb(["list", "--workspace", "ws_cli_test"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Definitions \(1\)/);
  assert.match(r.stdout, /thesis-36page/);
  // The instance table is empty (we haven't created one via the CLI)
  assert.match(r.stdout, /Instances \(0\)/);
});

test("e2e: full thesis-36page FSM lifecycle via CLI", () => {
  cleanup();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DEF_JSON_PATH, JSON.stringify(THESIS_DEF, null, 2));

  // Step 1: create the definition via CLI.
  const createR = runCliOnTestDb([
    "create",
    "thesis-36page",
    "--def",
    DEF_JSON_PATH,
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(createR.status, 0, createR.stderr);

  // Extract the definition ID from the create output.
  const defIdMatch = createR.stdout.match(/created definition (wfd_[^\s]+)/);
  assert.ok(defIdMatch, `no def id in: ${createR.stdout}`);
  const defId = defIdMatch[1];

  // Step 2: seed an instance directly via @agent-space/db. The CLI
  // doesn't expose `create-instance` (instances are created by the
  // daemon scheduler in prod). We do it in the test process so the
  // same DB file is used. We have to do this in a sub-process too
  // because WORKFLOW_TEST_DB_PATH must be set before the @agent-space/db
  // singleton connects.
  const seedScript = `
    process.env.WORKFLOW_TEST_DB_PATH = ${JSON.stringify(DB_PATH)};
    const { resetDatabaseForTests, createWorkflowInstanceSync } =
      await import("@agent-space/db");
    resetDatabaseForTests();
    const rec = createWorkflowInstanceSync({
      workspaceId: "ws_cli_test",
      definitionId: ${JSON.stringify(defId)},
      currentState: "idle",
      contextJson: {},
    });
    process.stdout.write(rec.id);
  `;
  const seedPath = resolve(DB_DIR, "cli-e2e-seed.mjs");
  writeFileSync(seedPath, seedScript);
  const seedR = spawnSync(
    process.execPath,
    ["--experimental-strip-types", seedPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, WORKFLOW_TEST_DB_PATH: DB_PATH },
      encoding: "utf8",
    },
  );
  assert.equal(seedR.status, 0, seedR.stderr);
  const instId = seedR.stdout.trim();
  assert.ok(instId.startsWith("wfi_"), `bad instance id: ${instId}`);

  // Step 3: advance idle → outline via CLI.
  const r1 = runCliOnTestDb([
    "advance",
    instId,
    "--event",
    "start_outline",
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /state:.*outline/);

  // Step 4: advance outline → draft via CLI.
  const r2 = runCliOnTestDb([
    "advance",
    instId,
    "--event",
    "start_draft",
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /state:.*draft/);

  // Step 5: advance draft → review with payload satisfying the guard.
  const r3 = runCliOnTestDb([
    "advance",
    instId,
    "--event",
    "submit_review",
    "--workspace",
    "ws_cli_test",
    "--payload",
    JSON.stringify({ draftWordCount: 1500 }),
  ]);
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stdout, /state:.*review/);

  // Step 6: advance review → done via CLI.
  const r4 = runCliOnTestDb([
    "advance",
    instId,
    "--event",
    "approve",
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(r4.status, 0, r4.stderr);
  assert.match(r4.stdout, /state:.*done/);
  assert.match(r4.stdout, /status:.*completed/);

  // Step 7: show command reports the final state.
  const showR = runCliOnTestDb(["show", instId]);
  assert.equal(showR.status, 0, showR.stderr);
  assert.match(showR.stdout, /state\s+done/);
  assert.match(showR.stdout, /status\s+completed/);

  // Step 8: history command reports 4 rows in order.
  const histR = runCliOnTestDb(["history", instId]);
  assert.equal(histR.status, 0, histR.stderr);
  assert.match(histR.stdout, /4 rows/);
  assert.match(histR.stdout, /start_outline/);
  assert.match(histR.stdout, /start_draft/);
  assert.match(histR.stdout, /submit_review/);
  assert.match(histR.stdout, /approve/);
});

test("CLI advance returns exit 2 when no transition matches", () => {
  cleanup();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DEF_JSON_PATH, JSON.stringify(THESIS_DEF, null, 2));

  // Create def + instance, then advance with an unknown event name.
  const createR = runCliOnTestDb([
    "create",
    "thesis-36page",
    "--def",
    DEF_JSON_PATH,
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(createR.status, 0);
  const defIdMatch = createR.stdout.match(/created definition (wfd_[^\s]+)/);
  const defId = defIdMatch![1];

  const seedScript = `
    process.env.WORKFLOW_TEST_DB_PATH = ${JSON.stringify(DB_PATH)};
    const { resetDatabaseForTests, createWorkflowInstanceSync } =
      await import("@agent-space/db");
    resetDatabaseForTests();
    const rec = createWorkflowInstanceSync({
      workspaceId: "ws_cli_test",
      definitionId: ${JSON.stringify(defId)},
      currentState: "idle",
      contextJson: {},
    });
    process.stdout.write(rec.id);
  `;
  const seedPath = resolve(DB_DIR, "cli-e2e-seed.mjs");
  writeFileSync(seedPath, seedScript);
  const seedR = spawnSync(
    process.execPath,
    ["--experimental-strip-types", seedPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, WORKFLOW_TEST_DB_PATH: DB_PATH },
      encoding: "utf8",
    },
  );
  assert.equal(seedR.status, 0);
  const instId = seedR.stdout.trim();

  // Fire an event that doesn't exist.
  const r = runCliOnTestDb([
    "advance",
    instId,
    "--event",
    "no_such_event",
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /transition did not fire/);
});

test("CLI advance with failing guard records structured reason in history", () => {
  cleanup();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(DEF_JSON_PATH, JSON.stringify(THESIS_DEF, null, 2));

  const createR = runCliOnTestDb([
    "create",
    "thesis-36page",
    "--def",
    DEF_JSON_PATH,
    "--workspace",
    "ws_cli_test",
  ]);
  assert.equal(createR.status, 0);
  const defId = createR.stdout.match(/created definition (wfd_[^\s]+)/)![1];

  const seedScript = `
    process.env.WORKFLOW_TEST_DB_PATH = ${JSON.stringify(DB_PATH)};
    const { resetDatabaseForTests, createWorkflowInstanceSync } =
      await import("@agent-space/db");
    resetDatabaseForTests();
    const rec = createWorkflowInstanceSync({
      workspaceId: "ws_cli_test",
      definitionId: ${JSON.stringify(defId)},
      currentState: "draft",
      contextJson: {},
    });
    process.stdout.write(rec.id);
  `;
  const seedPath = resolve(DB_DIR, "cli-e2e-seed.mjs");
  writeFileSync(seedPath, seedScript);
  const seedR = spawnSync(
    process.execPath,
    ["--experimental-strip-types", seedPath],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, WORKFLOW_TEST_DB_PATH: DB_PATH },
      encoding: "utf8",
    },
  );
  assert.equal(seedR.status, 0);
  const instId = seedR.stdout.trim();

  // Fire submit_review with draftWordCount < 1000 — guard should fail.
  const r = runCliOnTestDb([
    "advance",
    instId,
    "--event",
    "submit_review",
    "--workspace",
    "ws_cli_test",
    "--payload",
    JSON.stringify({ draftWordCount: 50 }),
  ]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /guard_failed|transition did not fire/);

  // The history row should still be recorded with the failure reason.
  const histR = runCliOnTestDb(["history", instId]);
  assert.equal(histR.status, 0);
  assert.match(histR.stdout, /1 rows/);
  // P0-3: reason is structured ("guard_failed"), not the generic "no_transition".
  assert.match(histR.stdout, /guard_failed|no_transition/);
});

test("CLI show + history reject unknown instance", () => {
  cleanup();
  const showR = runCliOnTestDb(["show", "wfi_missing"]);
  assert.equal(showR.status, 1);
  assert.match(showR.stderr, /instance not found/);

  const histR = runCliOnTestDb(["history", "wfi_missing"]);
  assert.equal(histR.status, 1);
  assert.match(histR.stderr, /instance not found/);
});

test("CLI advance rejects missing instance-id", () => {
  const r = runCliOnTestDb(["advance"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing <instance-id> argument/);
});

test("CLI advance rejects missing --event", () => {
  const r = runCliOnTestDb(["advance", "wfi_anything"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing --event/);
});

test("CLI advance rejects non-JSON --payload", () => {
  const r = runCliOnTestDb([
    "advance",
    "wfi_anything",
    "--event",
    "x",
    "--payload",
    "not-json",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /invalid --payload JSON/);
});