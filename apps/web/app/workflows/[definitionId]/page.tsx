// L4.3 — /workflows/[definitionId] page (Next.js Server Component).

import { loadDefinitionDetail } from "../loader.ts";
import { renderDefinitionDetailView } from "../views.ts";

export interface DefinitionDetailPageProps {
  params: { definitionId: string };
}

export async function DefinitionDetailPage(
  props: DefinitionDetailPageProps,
): Promise<ReturnType<typeof renderDefinitionDetailView>> {
  const data = loadDefinitionDetail(props.params.definitionId);
  return renderDefinitionDetailView(data);
}

export default DefinitionDetailPage;