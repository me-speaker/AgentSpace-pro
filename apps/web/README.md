# apps/web — L4.3 scaffold

This is the L4.3 AS-integration scaffold: a minimal Next.js 15 app
shape exposing three `/workflows/*` Server Component pages and the
server actions they call.

## What is here

```
app/
├── html.ts                              # hyperscript tree helper (h(), toHtml, findAll, textContent)
├── layout.tsx                           # root layout (html/body)
└── workflows/
    ├── loader.ts                        # data loaders + mutation helpers (DB → plain records)
    ├── views.ts                         # HNode renderers for the three pages
    ├── actions.ts                       # "use server" — server actions (call loader + view funcs)
    ├── page.tsx                         # /workflows — list view
    ├── [definitionId]/page.tsx          # /workflows/[definitionId] — definition detail
    ├── instances/[instanceId]/page.tsx  # /workflows/instances/[instanceId] — instance detail
    └── __tests__/
        ├── page.test.ts                 # tree-shape assertions (links, tables, empty states)
        └── actions.test.ts              # mock @agent-space/db + @agent-space/services, verify calls
```

## What is NOT here (intentionally)

- **No `npm install`.** Per MEMORY #22/24 the test repo keeps manual
  `node_modules/@agent-space/*` symlinks; `npm install` would clobber
  them. So `react`, `next`, `@testing-library/react` are not present.
- **No `next dev`.** The page modules are thin wrappers over the
  loader + view helpers. Tests assert on the helpers directly.
- **No real JSX.** Pages use the `h()` hyperscript helper so the
  modules are plain TypeScript and don't require the JSX runtime.

## Production deploy path

When speaker promotes this to the prod `AgentSpace` repo, the
deploy flow would be:

1. `cp -r apps/web/app /path/to/prod/AgentSpace/apps/web/`
2. Replace `h('div', {}, [...])` calls with JSX (`<div>{...}</div>`).
   The mapping is 1-to-1; a `sed` script is enough.
3. Add `next`, `react`, `react-dom`, `@testing-library/react` to the
   prod `apps/web/package.json` and run `npm install`.
4. Wire the real Postgres `WorkflowStore` via `runtime.setStore()`
   so `loader.ts` reads from prod instead of test SQLite.

The shape (`loader.ts` + `views.ts` + `actions.ts`) is the contract;
the implementation detail (JSX vs h()) is interchangeable.

## Tests

```sh
node --experimental-strip-types --test \
  app/workflows/__tests__/actions.test.ts \
  app/workflows/__tests__/page.test.ts
```

Or via the package script:

```sh
npm --prefix apps/web run test:web
```