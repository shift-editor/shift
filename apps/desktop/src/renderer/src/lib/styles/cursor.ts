import type { CursorType } from "@/types/editor";

export function cursorToCSS(cursor: CursorType): string {
  switch (cursor.type) {
    case "default":
      return `-webkit-image-set(url("/cursors/cursor@32.svg") 1x, url("/cursors/cursor@64.svg") 2x) 5 0, default`;
    case "move":
      return `-webkit-image-set(url("/cursors/cursor@32-moving.svg") 1x, url("/cursors/cursor@64-moving.svg") 2x) 5 0, move`;
    case "pen":
      return `-webkit-image-set(url("/cursors/pen@32.svg") 1x, url("/cursors/pen@64.svg") 2x) 8 8, crosshair`;
    case "pen-add":
      return `-webkit-image-set(url("/cursors/pen@32-add.svg") 1x, url("/cursors/pen@64-add.svg") 2x) 8 8, crosshair`;
    case "pen-end":
      return `-webkit-image-set(url("/cursors/pen@32-end.svg") 1x, url("/cursors/pen@64-end.svg") 2x) 8 8, crosshair`;
    case "ew-resize":
      return `-webkit-image-set(url("/cursors/resize@32-ew.svg") 1x, url("/cursors/resize@64-ew.svg") 2x) 16 16, ew-resize`;
    case "ns-resize":
      return `-webkit-image-set(url("/cursors/resize@32-ns.svg") 1x, url("/cursors/resize@64-ns.svg") 2x) 16 16, ns-resize`;
    case "nwse-resize":
      return `-webkit-image-set(url("/cursors/resize@32-nws.svg") 1x, url("/cursors/resize@64-nws.svg") 2x) 16 16, nwse-resize`;
    case "nesw-resize":
      return `-webkit-image-set(url("/cursors/resize@32-nes.svg?v=2") 1x, url("/cursors/resize@64-nes.svg?v=2") 2x) 16 16, nesw-resize`;
    case "rotate-tl":
      return `-webkit-image-set(url("/cursors/rotate@32-tl.svg") 1x, url("/cursors/rotate@64-tl.svg") 2x) 16 16, grab`;
    case "rotate-tr":
      return `-webkit-image-set(url("/cursors/rotate@32-tr.svg") 1x, url("/cursors/rotate@64-tr.svg") 2x) 16 16, grab`;
    case "rotate-bl":
      return `-webkit-image-set(url("/cursors/rotate@32-bl.svg") 1x, url("/cursors/rotate@64-bl.svg") 2x) 16 16, grab`;
    case "rotate-br":
      return `-webkit-image-set(url("/cursors/rotate@32-br.svg") 1x, url("/cursors/rotate@64-br.svg") 2x) 16 16, grab`;
    default:
      return cursor.type;
  }
}
