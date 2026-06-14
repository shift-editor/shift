import { Editor } from "@/lib/editor/Editor";
import { electronSystemClipboard } from "@/lib/clipboard";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";
import { Font } from "@/lib/model/Font";
import { WorkspaceClient } from "@/lib/workspace/WorkspaceClient";
import { WorkspaceEditQueue } from "@/lib/workspace/WorkspaceEditQueue";
import { getShiftHost } from "@/host/shiftHost";

let instance: GlyphInfo | null = null;
export function getGlyphInfo(): GlyphInfo {
  if (!instance) instance = new GlyphInfo(defaultResources);
  return instance;
}

const workspace = new WorkspaceClient(getShiftHost());
const editQueue = new WorkspaceEditQueue(workspace);
const font = new Font(workspace.$workspace, editQueue);
const editor = new Editor({ font, clipboard: electronSystemClipboard });
registerBuiltInTools(editor);

// Set select tool as ready on startup
editor.setActiveTool("select");

void workspace.connected();

getShiftHost().document.onFlushRequested(({ requestId }) => {
  void editQueue
    .settled()
    .then(() => getShiftHost().document.flushCompleted({ requestId }))
    .catch((error) =>
      getShiftHost().document.flushCompleted({
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .catch((error) => {
      console.error("document flush completion failed", error);
    });
});

export const getWorkspace = () => workspace;
export const getEditor = () => editor;
export const getFont = () => font;

// Expose editor on window for Playwright E2E tests.
declare const __PLAYWRIGHT__: boolean | undefined;
if (typeof __PLAYWRIGHT__ !== "undefined" && __PLAYWRIGHT__) {
  (window as unknown as Record<string, unknown>).__shift = {
    getEditor,
    getWorkspace,
    getFont,
  };
}
