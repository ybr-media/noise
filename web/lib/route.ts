export type RouteTab = "create" | "library" | "releases";

export type AppRoute = {
  tab: RouteTab;
  trackId?: string;
  releaseId?: string;
  activity: boolean;
};

function decodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRoute(hash: string): AppRoute {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf("?");
  const path = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : raw.slice(queryIndex + 1);
  const activity = new URLSearchParams(query).has("activity");

  if (path === "design") return { tab: "create", activity };
  if (path === "queue") return { tab: "library", activity: true };
  if (path === "" || path === "create") return { tab: "create", activity };
  if (path === "library") return { tab: "library", activity };
  if (path.startsWith("library/")) return { tab: "library", trackId: decodeId(path.slice("library/".length)), activity };
  if (path === "releases") return { tab: "releases", activity };
  if (path.startsWith("releases/")) return { tab: "releases", releaseId: decodeId(path.slice("releases/".length)), activity };
  return { tab: "create", activity };
}

export function serializeRoute(route: AppRoute): string {
  const path = route.tab === "create"
    ? "create"
    : route.tab === "library"
      ? route.trackId === undefined ? "library" : `library/${encodeURIComponent(route.trackId)}`
      : route.releaseId === undefined ? "releases" : `releases/${encodeURIComponent(route.releaseId)}`;
  return `#${path}${route.activity ? "?activity" : ""}`;
}
