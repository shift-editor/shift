import type { FeedURLOptions } from "electron";
import type { UpdateFeedTarget } from "./types";

/** Returns the fixed native Squirrel feed for an automatically updated target. */
export function updateFeed(feedBaseUrl: string, target: UpdateFeedTarget): FeedURLOptions | null {
  const baseUrl = feedBaseUrl.endsWith("/") ? feedBaseUrl : `${feedBaseUrl}/`;
  if (new URL(baseUrl).protocol !== "https:") throw new Error("Update feed must use HTTPS");

  switch (target.platform) {
    case "darwin":
      if (target.architecture !== "arm64" && target.architecture !== "x64") return null;

      return {
        url: new URL(
          `${target.distribution}/darwin/${target.architecture}/RELEASES.json`,
          baseUrl,
        ).toString(),
        serverType: "json",
      };
    case "win32":
      if (target.distribution !== "nightly" || target.architecture !== "x64") return null;

      return {
        url: new URL(`${target.distribution}/win32/${target.architecture}`, baseUrl).toString(),
      };
    default:
      return null;
  }
}
