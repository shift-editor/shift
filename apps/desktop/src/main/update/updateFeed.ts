import type { UpdateFeedTarget } from "./types";

/** Returns the fixed native Squirrel feed URL for one packaged Shift target. */
export function loadUpdate(feedBaseUrl: string, target: UpdateFeedTarget): string {
  const baseUrl = feedBaseUrl.endsWith("/") ? feedBaseUrl : `${feedBaseUrl}/`;
  const url = new URL(nativeFeedPath(target), baseUrl);
  if (url.protocol !== "https:") throw new Error("Update feed must use HTTPS");
  return url.toString();
}

function nativeFeedPath(target: UpdateFeedTarget): string {
  switch (target.platform) {
    case "darwin":
      if (target.architecture !== "arm64" && target.architecture !== "x64") {
        throw new Error(`Unsupported macOS update architecture: ${target.architecture}`);
      }
      return `${target.distribution}/darwin/${target.architecture}/RELEASES.json`;
    case "win32":
      if (target.architecture !== "x64") {
        throw new Error(`Unsupported Windows update architecture: ${target.architecture}`);
      }
      return `${target.distribution}/win32/${target.architecture}`;
    default:
      throw new Error(`Unsupported automatic-update platform: ${target.platform}`);
  }
}
