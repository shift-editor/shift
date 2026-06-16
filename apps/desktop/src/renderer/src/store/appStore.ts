import { Editor } from "@/lib/editor/Editor";
import { electronSystemClipboard } from "@/lib/clipboard";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";
import { Font } from "@/lib/model/Font";
import { WorkspaceClient } from "@/lib/workspace/WorkspaceClient";
import { WorkspaceEditQueue } from "@/lib/workspace/WorkspaceEditQueue";
import { getShiftHost } from "@/host/shiftHost";
import type { DocumentCallMap, DocumentEventMap } from "@shared/ipc/contract";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";

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

const host = getShiftHost();
let documentRequests: ChannelServer<DocumentEventMap> | null = null;

void serveDocumentRequests().catch((error) => {
  console.error("document request lane failed", error);
});

async function serveDocumentRequests(): Promise<void> {
  const port = nextDocumentPort();

  try {
    await host.document.connect();
  } catch (error) {
    port.cancel();
    throw error;
  }

  documentRequests?.dispose();
  documentRequests = serveChannel<DocumentCallMap, DocumentEventMap>(
    domPortTransport(await port.received),
    {
      "document.state": () => editQueue.state(),
      "document.create": () => editQueue.create(),
      "document.save": ({ path }) => editQueue.save(path),
      "document.open": ({ path }) => editQueue.open(path),
    },
  );
}

function nextDocumentPort(): { received: Promise<MessagePort>; cancel: () => void } {
  let cancel = () => {};

  const received = new Promise<MessagePort>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: string } | null)?.type !== "document.port") return;

      const port = event.ports[0];
      if (!port) return;

      window.removeEventListener("message", listener);
      resolve(port);
    };

    cancel = () => window.removeEventListener("message", listener);
    window.addEventListener("message", listener);
  });

  return { received, cancel };
}

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
