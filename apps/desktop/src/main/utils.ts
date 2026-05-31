import path from "path";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

export interface RenderSource {
  type: "url" | "file";
  source: string;
}
export function getRendererSource(): RenderSource {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return {
      type: "url",
      source: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    };
  }

  return {
    type: "file",
    source: path.join(__dirname, "../renderer/index.html"),
  };
}
