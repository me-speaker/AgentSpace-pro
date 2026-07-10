// L4.3 — view functions for the /workflows pages.
//
// Each view takes plain data and returns an HNode tree (the shape
// React.createElement produces). This decouples rendering from data
// fetching so tests can:
//
//   1. Verify rendering: assert on tree structure (href, table rows,
//      text content) — no react/jsdom required.
//   2. Verify data fetching separately (see loader.ts + actions tests).
//
// In prod, these trees would be JSX (one-to-one mapping: `h('div',
// {}, [...])` ↔ `<div>{...}</div>`). For the L4.3 scaffold we use the
// hyperscript form so the test repo stays free of npm installs.

import { h, type HNode } from "../html.ts";
import type {
  WorkflowDefinitionRecord,
  WorkflowInstanceRecord,
  WorkflowHistoryRecord,
} from "@agent-space/db";

// ── /workflows — list view ───────────────────────────────────────────────────

export function renderWorkflowsListView(input: {
  workspaceId: string;
  definitions: WorkflowDefinitionRecord[];
  instances: WorkflowInstanceRecord[];
}): HNode {
  return h("div", { class: "workflows-list" }, [
    h("h1", {}, [`Workflows — workspace ${input.workspaceId}`]),
    h("section", { "data-testid": "definitions" }, [
      h("h2", {}, ["Definitions"]),
      renderDefinitionsTable(input.definitions),
    ]),
    h("section", { "data-testid": "instances" }, [
      h("h2", {}, ["Instances"]),
      renderInstancesTable(input.instances),
    ]),
  ]);
}

function renderDefinitionsTable(
  definitions: WorkflowDefinitionRecord[],
): HNode {
  if (definitions.length === 0) {
    return h("p", { "data-testid": "definitions-empty" }, [
      "No workflow definitions yet.",
    ]);
  }
  return h(
    "table",
    { "data-testid": "definitions-table" },
    [
      h("thead", {}, [
        h("tr", {}, [
          h("th", {}, ["ID"]),
          h("th", {}, ["Name"]),
          h("th", {}, ["Version"]),
          h("th", {}, ["Updated"]),
        ]),
      ]),
      h(
        "tbody",
        {},
        definitions.map((d) =>
          h("tr", { key: d.id, "data-testid": `definition-${d.id}` }, [
            h("td", {}, [
              h(
                "a",
                { href: `/workflows/${d.id}`, "data-testid": `definition-link-${d.id}` },
                [d.id],
              ),
            ]),
            h("td", {}, [d.name]),
            h("td", {}, [String(d.version)]),
            h("td", {}, [d.updatedAt]),
          ]),
        ),
      ),
    ],
  );
}

function renderInstancesTable(
  instances: WorkflowInstanceRecord[],
): HNode {
  if (instances.length === 0) {
    return h("p", { "data-testid": "instances-empty" }, [
      "No workflow instances yet.",
    ]);
  }
  return h(
    "table",
    { "data-testid": "instances-table" },
    [
      h("thead", {}, [
        h("tr", {}, [
          h("th", {}, ["ID"]),
          h("th", {}, ["Definition"]),
          h("th", {}, ["State"]),
          h("th", {}, ["Status"]),
          h("th", {}, ["Updated"]),
        ]),
      ]),
      h(
        "tbody",
        {},
        instances.map((inst) =>
          h("tr", { key: inst.id, "data-testid": `instance-row-${inst.id}` }, [
            h("td", {}, [
              h(
                "a",
                {
                  href: `/workflows/instances/${inst.id}`,
                  "data-testid": `instance-link-${inst.id}`,
                },
                [inst.id],
              ),
            ]),
            h("td", {}, [inst.definitionId]),
            h("td", {}, [inst.currentState]),
            h("td", {}, [
              h("span", { "data-testid": `instance-status-${inst.id}` }, [
                inst.status,
              ]),
            ]),
            h("td", {}, [inst.updatedAt]),
          ]),
        ),
      ),
    ],
  );
}

// ── /workflows/[definitionId] — detail view ──────────────────────────────────

export function renderDefinitionDetailView(input: {
  definition: WorkflowDefinitionRecord | null;
  instances: WorkflowInstanceRecord[];
}): HNode {
  if (!input.definition) {
    return h("div", { "data-testid": "definition-not-found" }, [
      h("h1", {}, ["Definition not found"]),
    ]);
  }
  const d = input.definition;
  return h("div", { class: "definition-detail" }, [
    h("h1", {}, [d.name]),
    h("dl", { "data-testid": "definition-meta" }, [
      h("dt", {}, ["ID"]),
      h("dd", { "data-testid": "definition-id" }, [d.id]),
      h("dt", {}, ["Workspace"]),
      h("dd", { "data-testid": "definition-workspace" }, [d.workspaceId]),
      h("dt", {}, ["Version"]),
      h("dd", {}, [String(d.version)]),
      h("dt", {}, ["Created"]),
      h("dd", {}, [d.createdAt]),
      h("dt", {}, ["Updated"]),
      h("dd", {}, [d.updatedAt]),
    ]),
    h("section", { "data-testid": "definition-instances" }, [
      h("h2", {}, ["Instances of this definition"]),
      input.instances.length === 0
        ? h("p", { "data-testid": "definition-instances-empty" }, [
            "No instances spawned from this definition yet.",
          ])
        : h(
            "ul",
            {},
            input.instances.map((inst) =>
              h("li", { key: inst.id }, [
                h(
                  "a",
                  {
                    href: `/workflows/instances/${inst.id}`,
                    "data-testid": `instance-link-${inst.id}`,
                  },
                  [`${inst.id} — ${inst.currentState} (${inst.status})`],
                ),
              ]),
            ),
          ),
    ]),
  ]);
}

// ── /workflows/instances/[instanceId] — detail view ──────────────────────────

export function renderInstanceDetailView(input: {
  instance: WorkflowInstanceRecord | null;
  definition: WorkflowDefinitionRecord | null;
  history: WorkflowHistoryRecord[];
}): HNode {
  if (!input.instance) {
    return h("div", { "data-testid": "instance-not-found" }, [
      h("h1", {}, ["Instance not found"]),
    ]);
  }
  const inst = input.instance;
  return h("div", { class: "instance-detail" }, [
    h("h1", {}, [`Instance ${inst.id}`]),
    h("dl", { "data-testid": "instance-meta" }, [
      h("dt", {}, ["ID"]),
      h("dd", { "data-testid": "instance-id" }, [inst.id]),
      h("dt", {}, ["Definition"]),
      h("dd", {}, [
        h(
          "a",
          {
            href: input.definition
              ? `/workflows/${input.definition.id}`
              : "#",
          },
          [inst.definitionId],
        ),
      ]),
      h("dt", {}, ["Workspace"]),
      h("dd", {}, [inst.workspaceId]),
      h("dt", {}, ["Current state"]),
      h("dd", { "data-testid": "instance-current-state" }, [inst.currentState]),
      h("dt", {}, ["Status"]),
      h("dd", { "data-testid": "instance-status" }, [inst.status]),
      h("dt", {}, ["Attempts"]),
      h("dd", { "data-testid": "instance-attempts" }, [String(inst.attemptCount)]),
      h("dt", {}, ["Created"]),
      h("dd", {}, [inst.createdAt]),
      h("dt", {}, ["Updated"]),
      h("dd", {}, [inst.updatedAt]),
    ]),
    h("section", { "data-testid": "instance-history" }, [
      h("h2", {}, [`History (${input.history.length})`]),
      input.history.length === 0
        ? h("p", { "data-testid": "instance-history-empty" }, [
            "No history rows.",
          ])
        : h(
            "ol",
            {},
            input.history.map((row) =>
              h("li", { key: row.id, "data-testid": `history-row-${row.id}` }, [
                `${row.createdAt} — ${row.eventType}: ${row.fromState ?? "(start)"} → ${row.toState ?? "(none)"}`,
              ]),
            ),
          ),
    ]),
  ]);
}
// ── P2-5 — History rendering with search/filter/pagination ────────────────
//
// L4.3's renderInstanceDetailView renders history as a flat ol list.
// P2-5 splits history rendering into its own helper so the same
// function can be reused by the server, RSC, or any future tooling,
// and so we can keep the original renderInstanceDetailView untouched
// for backward compat (existing page.test.ts / actions.test.ts use it).

import type { HistoryQueryResult } from "./loader.ts";

export interface HistoryViewFilters {
  eventType?: string;
  searchText?: string;
}

export function renderHistorySection(input: {
  historyResult: HistoryQueryResult;
  filters: HistoryViewFilters;
  instanceId: string;
}): HNode {
  const { historyResult: r, filters, instanceId } = input;
  const start = r.totalCount === 0 ? 0 : r.offset + 1;
  const end = r.offset + r.rows.length;

  const children: HNode[] = [];

  // ── filter chips (what's active) ─────────────────────────────────────
  const activeFilters: HNode[] = [];
  if (filters.eventType) {
    activeFilters.push(
      h("span", { "data-testid": "history-filter-event-type-chip" }, [
        `event: ${filters.eventType}`,
      ]),
    );
  }
  if (filters.searchText && filters.searchText.length > 0) {
    activeFilters.push(
      h("span", { "data-testid": "history-filter-search-chip" }, [
        `search: "${filters.searchText}"`,
      ]),
    );
  }
  if (activeFilters.length > 0) {
    children.push(
      h("div", { "data-testid": "history-active-filters" }, activeFilters),
    );
  }

  // ── count + rows ──────────────────────────────────────────────────────
  if (r.rows.length === 0) {
    children.push(
      h("p", { "data-testid": "history-empty" }, [
        r.totalCount === 0
          ? "No history rows yet."
          : "No rows match the current filter.",
      ]),
    );
  } else {
    children.push(
      h(
        "ol",
        { "data-testid": "history-paginated-list" },
        r.rows.map((row) =>
          h("li", {
            key: row.id,
            "data-testid": `history-row-${row.id}`,
          }, [
            `${row.createdAt} — ${row.eventType}: ${row.fromState ?? "(start)"} → ${row.toState ?? "(none)"}`,
          ]),
        ),
      ),
    );
  }

  // ── footer (pagination) ──────────────────────────────────────────────
  const prevOffset = Math.max(0, r.offset - r.pageSize);
  const nextOffset = r.offset + r.pageSize;
  const prevDisabled = r.offset === 0;
  const nextDisabled = !r.hasMore;

  const pagination: HNode[] = [
    h(
      "a",
      {
        href: buildHistoryHref(instanceId, filters, prevOffset),
        "data-testid": "history-prev",
        ...(prevDisabled ? { "aria-disabled": "true" } : {}),
      },
      ["← Previous"],
    ),
    h("span", { "data-testid": "history-count" }, [
      `Showing ${start}-${end} of ${r.totalCount}`,
    ]),
    h(
      "a",
      {
        href: buildHistoryHref(instanceId, filters, nextOffset),
        "data-testid": "history-next",
        ...(nextDisabled ? { "aria-disabled": "true" } : {}),
      },
      ["Next →"],
    ),
  ];
  children.push(
    h("div", { "data-testid": "history-pagination" }, pagination),
  );

  return h("section", { "data-testid": "history-section" }, children);
}

function buildHistoryHref(
  instanceId: string,
  filters: HistoryViewFilters,
  offset: number,
): string {
  const params = new URLSearchParams();
  if (filters.eventType) params.set("eventType", filters.eventType);
  if (filters.searchText) params.set("searchText", filters.searchText);
  if (offset > 0) params.set("offset", String(offset));
  const qs = params.toString();
  return `/workflows/instances/${instanceId}${qs ? `?${qs}` : ""}`;
}

// ── V2 instance detail view that takes a HistoryQueryResult ────────────
//
// Sibling to renderInstanceDetailView (L4.3). Renderers stay parallel:
// V2 calls renderHistorySection with the query result; L4.3 keeps the
// flat ol list. Both can be tested independently.

export function renderInstanceDetailViewV2(input: {
  instance: WorkflowInstanceRecord | null;
  definition: WorkflowDefinitionRecord | null;
  historyResult: HistoryQueryResult;
  filters: HistoryViewFilters;
}): HNode {
  if (!input.instance) {
    return h("div", { "data-testid": "instance-not-found" }, [
      h("h1", {}, ["Instance not found"]),
    ]);
  }
  const inst = input.instance;
  return h("div", { class: "instance-detail" }, [
    h("h1", {}, [`Instance ${inst.id}`]),
    h("dl", { "data-testid": "instance-meta" }, [
      h("dt", {}, ["ID"]),
      h("dd", { "data-testid": "instance-id" }, [inst.id]),
      h("dt", {}, ["Definition"]),
      h("dd", {}, [
        h(
          "a",
          {
            href: input.definition
              ? `/workflows/${input.definition.id}`
              : "#",
          },
          [inst.definitionId],
        ),
      ]),
      h("dt", {}, ["Workspace"]),
      h("dd", {}, [inst.workspaceId]),
      h("dt", {}, ["Current state"]),
      h("dd", { "data-testid": "instance-current-state" }, [
        inst.currentState,
      ]),
      h("dt", {}, ["Status"]),
      h("dd", { "data-testid": "instance-status" }, [inst.status]),
      h("dt", {}, ["Attempts"]),
      h("dd", { "data-testid": "instance-attempts" }, [
        String(inst.attemptCount),
      ]),
      h("dt", {}, ["Created"]),
      h("dd", {}, [inst.createdAt]),
      h("dt", {}, ["Updated"]),
      h("dd", {}, [inst.updatedAt]),
    ]),
    renderHistorySection({
      historyResult: input.historyResult,
      filters: input.filters,
      instanceId: inst.id,
    }),
  ]);
}
