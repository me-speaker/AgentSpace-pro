# AgentSpace FSM \u2014 L2 Sandbox

This directory is the **L2 sandbox** for the Finite State Machine work. It
contains only the files needed to develop + test the FSM runtime and store
in isolation \u2014 no `next-server`, no daemon, no production database.

## What is here

```
packages/
\u251c\u2500\u2500 domain/
\u2502\u00a0\u00a0\u2514\u2500\u2500 src/
\u2502\u00a0\u00a0\u00a0\u00a0\u2514\u2500\u2500 workflows.ts          # FSM schema types (FSM 1.1)
\u2514\u2500\u2500 services/
\u00a0\u00a0\u251c\u2500\u2500 src/
\u00a0\u00a0\u2502\u00a0\u00a0\u251c\u2500\u2500 index.ts              # public exports
\u00a0\u00a0\u2502\u00a0\u00a0\u2514\u2500\u2500 workflows/
\u00a0\u00a0\u2502\u00a0\u00a0\u00a0\u00a0\u251c\u2500\u2500 runtime.ts        # FSM step (vm sandbox + store hooks)
\u00a0\u00a0\u2502\u00a0\u00a0\u00a0\u00a0\u251c\u2500\u2500 runtime.test.ts  # 28 tests (18 L1 + 10 L2 round-trip)
\u00a0\u00a0\u2502\u00a0\u00a0\u00a0\u00a0\u251c\u2500\u2500 store.ts          # *Sync CRUD (in-memory Map backing)
\u00a0\u00a0\u2502\u00a0\u00a0\u00a0\u00a0\u2514\u2500\u2500 store.test.ts     # 17 tests (store CRUD contract)
```

## What is NOT here (intentionally)

This sandbox does not include:

- `packages/db/src/postgres-schema.ts` \u2014 the reference schema for the 3
  workflow tables lives in the parent AgentSpace repo. The store.ts in this
  sandbox mirrors the contract (workspace_id-scoped, jsonb bodies, FK
  cascade) so swapping in a Postgres-backed implementation is a drop-in
  change against the `WorkflowStore` interface.
- `packages/services/src/approvals/`, `task-execution-events.ts`, etc. \u2014
  the reference *Sync style sources live in the parent repo. The store.ts
  here follows the same `create*Sync / read*Sync / update*Sync /
  delete*Sync` naming + sync I/O shape.
- `next-server` / agent-space-daemon \u2014 no live server runs in this
  sandbox, so the FSM step is exercised as a pure in-memory function
  (and through the optional store hook).

## Run the tests

```bash
export PATH=/home/speaker/.nvm/versions/node/v24.17.0/bin:$PATH
cd /home/speaker/AgentSpace-test

# Runtime tests \u2014 28 pass (18 L1 + 10 L2 round-trip)
node --experimental-strip-types packages/services/src/workflows/runtime.test.ts

# Store tests \u2014 17 pass
node --experimental-strip-types packages/services/src/workflows/store.test.ts
```

## L2 changes (2026-07-02)

- **vm.runInNewContext** replaces `new Function()` for guard evaluation.
  200ms hard timeout. Host globals (`process`, `require`, etc.) are not
  visible from inside the sandbox. See `GUARD_VM_TIMEOUT_MS` in runtime.ts.
- **store.ts** adds the *Sync CRUD layer (11 functions + 1 factory).
  Backed by `Map` in this sandbox; the same interface is what a future
  Postgres-backed implementation will implement.
- **runtime.ts** now optionally persists via `setStore(store)`. Without
  a store, behaviour is identical to L1 (preserves the original 18 tests).
- **index.ts** exports the runtime + store so consumers can `import {
  createWorkflowInstance, executeTransition, createInMemoryWorkflowStore,
  setStore } from "@agent-space/services"`.
- **Status mapping** between runtime (`"running"`) and store
  (`"active"`) lives at the persistence boundary \u2014 see
  `toStoreStatus()` / `toRuntimeStatus()` in runtime.ts.

## Hard rules (still in force)

- Never touch `/home/speaker/AgentSpace/`.
- Never `pkill` the next-server / daemon.
- Never `reset HEAD` \u2014 use `git stash` on failure.
- Never `push` or `merge` from this sandbox.