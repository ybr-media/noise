import { dispatchRender } from "./dispatch";
import { sanitizeFxBlock } from "./fx";
import { enqueue } from "./queue";
import { RENDER_MODE, findVariant, resolveSelection, validateRenderOverrides, type RenderMode, type RenderSelection } from "./config";
import type { QueueJob } from "./types";

type QueueActionPayload = {
  error?: string;
  mode?: RenderMode;
  jobs?: QueueJob[];
};
export async function submitQueueSelection(selection: RenderSelection): Promise<{
  status: number;
  payload: QueueActionPayload;
}> {
  if (RENDER_MODE === "unavailable") {
    return { status: 503, payload: { error: "Rendering needs the local Audacity worker; this deployment is browse-only" } };
  }
  let overrides;
  try {
    overrides = validateRenderOverrides(selection);
  } catch (error) {
    return { status: 400, payload: { error: error instanceof Error ? error.message : "Invalid render overrides" } };
  }
  const { variantIds, dispatchInput } = resolveSelection(selection);
  if (!variantIds.length || variantIds.some((id) => !findVariant(id))) {
    return { status: 400, payload: { error: "Choose one or more known variants" } };
  }
  const fx = sanitizeFxBlock(selection.fx);
  if (RENDER_MODE === "local") {
    return { status: 202, payload: { mode: RENDER_MODE, jobs: enqueue(variantIds, fx, overrides) } };
  }
  try {
    await dispatchRender(dispatchInput, fx, overrides);
  } catch (error) {
    return { status: 502, payload: { error: error instanceof Error ? error.message : "Render dispatch failed" } };
  }
  return { status: 202, payload: { mode: RENDER_MODE, jobs: [] } };
}
