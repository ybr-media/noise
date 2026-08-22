import { bundleFor, type ArtifactIndex } from "./artifacts";

export function prebuiltBundleFilename(
  index: ArtifactIndex,
  renderKey: string,
  archiveFilename: string,
): string | undefined {
  const bundle = bundleFor(index, renderKey);
  return bundle?.filename === archiveFilename ? bundle.filename : undefined;
}
