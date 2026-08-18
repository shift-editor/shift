import { describe, expect, it } from "vitest";
import type { CursorType } from "@/types/editor";
import { cursorToCSS } from "./cursor";

const PACKAGED_RENDERER_URL = new URL(
  "file:///Applications/Shift.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html",
);
const PACKAGED_CURSOR_DIRECTORY = new URL("./cursors/", PACKAGED_RENDERER_URL);
const CUSTOM_CURSORS: CursorType[] = [
  { type: "default" },
  { type: "move" },
  { type: "copy" },
  { type: "pen" },
  { type: "pen-add" },
  { type: "pen-end" },
  { type: "ew-resize" },
  { type: "ns-resize" },
  { type: "nwse-resize" },
  { type: "nesw-resize" },
  { type: "rotate-tl" },
  { type: "rotate-tr" },
  { type: "rotate-bl" },
  { type: "rotate-br" },
];

function cursorAssetUrls(cursor: CursorType): string[] {
  return [...cursorToCSS(cursor).matchAll(/url\("([^"]+)"\)/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

describe("custom cursors in packaged renderers", () => {
  it.each(CUSTOM_CURSORS)("resolves $type assets beside the renderer", (cursor) => {
    const assetUrls = cursorAssetUrls(cursor).map((url) => new URL(url, PACKAGED_RENDERER_URL));

    expect(assetUrls).toHaveLength(2);
    for (const assetUrl of assetUrls) {
      expect(assetUrl.href.startsWith(PACKAGED_CURSOR_DIRECTORY.href)).toBe(true);
    }
  });
});
