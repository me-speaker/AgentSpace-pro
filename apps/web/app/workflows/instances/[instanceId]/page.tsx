// L4.3 — /workflows/instances/[instanceId] page (Next.js Server Component).

import { loadInstanceDetail } from "../../loader.ts";
import { renderInstanceDetailView } from "../../views.ts";

export interface InstanceDetailPageProps {
  params: { instanceId: string };
}

export async function InstanceDetailPage(
  props: InstanceDetailPageProps,
): Promise<ReturnType<typeof renderInstanceDetailView>> {
  const data = loadInstanceDetail(props.params.instanceId);
  return renderInstanceDetailView(data);
}

export default InstanceDetailPage;