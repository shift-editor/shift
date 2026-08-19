import type { UpdateFeed, UpdateFeedTarget } from "./types";

/** Returns the fixed electron-updater channel for an automatically updated target. */
export function updateFeed(feedBaseUrl: string, target: UpdateFeedTarget): UpdateFeed | null {
  const baseUrl = feedBaseUrl.endsWith("/") ? feedBaseUrl : `${feedBaseUrl}/`;
  if (new URL(baseUrl).protocol !== "https:") throw new Error("Update feed must use HTTPS");

  switch (target.platform) {
    case "darwin":
      if (target.architecture !== "arm64" && target.architecture !== "x64") return null;
      break;
    case "win32":
      if (target.distribution !== "nightly" || target.architecture !== "x64") return null;
      break;
    default:
      return null;
  }

  return {
    provider: "generic",
    url: new URL(
      `${target.distribution}/${target.platform}/${target.architecture}`,
      baseUrl,
    ).toString(),
  };
}
