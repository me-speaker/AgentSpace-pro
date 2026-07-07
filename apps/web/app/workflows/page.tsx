// L4.3 — /workflows page (Next.js Server Component).
//
// Production deploy would render this through next.js's RSC pipeline.
// In the L4.3 scaffold (test repo), the page module is a thin wrapper
// over the loader + view functions. The tests exercise the
// loader/view in isolation so we don't need react/next installed.

import { loadWorkflowsList } from "./loader.ts";
import { renderWorkflowsListView } from "./views.ts";

export interface WorkflowsListPageProps {
  params: { workspaceId?: string };
}

export async function WorkflowsListPage(
  props: WorkflowsListPageProps,
): Promise<ReturnType<typeof renderWorkflowsListView>> {
  const workspaceId = props.params.workspaceId ?? "default";
  const data = loadWorkflowsList(workspaceId);
  return renderWorkflowsListView(data);
}

// Default export matches the Next.js convention: a single page component.
export default WorkflowsListPage;