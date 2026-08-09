import { dispatchRender } from "./dispatch";
import { enqueue } from "./queue";
import { RENDER_MODE, findVariant, resolveSelection, type RenderSelection } from "./config";

export async function submitQueueSelection(selection: RenderSelection): Promise<{
  status: number;
  payload: { error?: string; mode?: string; jobs: unknown[] };
}> {
  if (RENDER_MODE === "unavailable") {
    return { status: 503, payload: { error: "Rendering needs the local Audacity worker; this deployment is browse-only", jobs: [] } };
  }
  const { variantIds, dispatchInput } = resolveSelection(selection);
  if (!variantIds.length || variantIds.some((id) => !findVariant(id))) {
    return { status: 400, payload: { error: "Choose one or more known variants", jobs: [] } };
  }
  if (RENDER_MODE === "local") {
    return { status: 202, payload: { mode: RENDER_MODE, jobs: enqueue(variantIds) } };
  }
  try {
    await dispatchRender(dispatchInput);
  } catch (error) {
    return { status: 502, payload: { error: error instanceof Error ? error.message : "Render dispatch failed", jobs: [] } };
  }
  return { status: 202, payload: { mode: RENDER_MODE, jobs: [] } };
}
