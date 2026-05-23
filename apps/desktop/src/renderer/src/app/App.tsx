import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { DebugProvider } from "@/context/DebugContext";
import { ZoomToast } from "@/components/chrome/ZoomToast";
import { isDev } from "@/lib/utils/utils";
import { dumpSelectionPatternsToConsole } from "@/lib/debug/dumpSelectionPatterns";
import { getDocument } from "@/store/store";
import { documentPersistence } from "@/persistence";

import { RouteDispatcher } from "./RouteDispatcher";

const HOME_HASH = "#/home";
const EDITOR_HASH_RE = /^#\/editor\/([^/?#]+)/;

function navigateToHome(): void {
  if (window.location.hash !== HOME_HASH) {
    window.location.hash = HOME_HASH;
  }
}

function isLandingHash(hash: string): boolean {
  return hash === "" || hash === "#" || hash === "#/";
}

function needsLoadedDocument(hash: string): boolean {
  return !isLandingHash(hash);
}

function parseEditorUnicodeFromHash(hash: string): number | null {
  const match = hash.match(EDITOR_HASH_RE);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 16);
  return Number.isNaN(parsed) ? null : parsed;
}

export const App = () => {
  useEffect(() => {
    const fontDocument = getDocument();
    const editor = fontDocument.editor;
    documentPersistence.init(editor);
    let didOpenFont = false;

    const handleBeforeUnload = () => {
      documentPersistence.flushNow();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const handleOpenFont = (filePath: string, source: "event" | "restore" = "event") => {
      if (source === "restore" && didOpenFont) {
        return;
      }

      try {
        fontDocument.openFont(filePath);
        didOpenFont = true;

        if (source === "restore") {
          const unicode = parseEditorUnicodeFromHash(window.location.hash);
          if (unicode !== null) {
            const handle = editor.font.glyphHandleForUnicode(unicode);
            editor.getGlyph(handle);
          }
        } else {
          navigateToHome();
        }
      } catch (error) {
        console.error("Failed to load font:", error);
      }
    };

    if (isDev) {
      void (async () => {
        // Keep normal startup UX: do not auto-open when landing page is active.
        if (isLandingHash(window.location.hash)) {
          return;
        }

        const state = documentPersistence.getState();
        const mostRecentDocId = state.registry.lruDocIds[0];
        const mostRecentPath = mostRecentDocId ? state.registry.docIdToPath[mostRecentDocId] : null;
        if (!mostRecentPath) {
          fontDocument.createFont();
          return;
        }

        const exists = await window.electronAPI?.pathsExist([mostRecentPath]);
        if (!exists?.[0]) {
          fontDocument.createFont();
          return;
        }

        handleOpenFont(mostRecentPath, "restore");
      })();
    } else if (needsLoadedDocument(window.location.hash) && !fontDocument.loaded) {
      fontDocument.createFont();
    }

    const unsubscribeOpen = window.electronAPI?.onMenuOpenFont(handleOpenFont);
    const unsubscribeExternalOpen = window.electronAPI?.onExternalOpenFont(handleOpenFont);
    const unsubscribeNew = window.electronAPI?.onDocumentNew(() => {
      fontDocument.createFont();
      didOpenFont = true;
      navigateToHome();
    });

    const unsubscribeSave = window.electronAPI?.onMenuSaveFont(async (savePath) => {
      try {
        await fontDocument.saveFont(savePath);
      } catch (error) {
        console.error("Failed to save font:", error);
      }
    });

    const unsubscribeExport = window.electronAPI?.onMenuExportFont(async (exportPath) => {
      try {
        await fontDocument.exportFont(exportPath);
      } catch (error) {
        console.error("Failed to export font:", error);
      }
    });

    const unsubscribePatternDump = window.electronAPI?.onDebugDumpSelectionPatterns(() => {
      dumpSelectionPatternsToConsole();
    });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      documentPersistence.dispose();
      if (unsubscribeNew) unsubscribeNew();
      if (unsubscribeOpen) unsubscribeOpen();
      if (unsubscribeExternalOpen) unsubscribeExternalOpen();
      if (unsubscribeSave) unsubscribeSave();
      if (unsubscribeExport) unsubscribeExport();
      if (unsubscribePatternDump) unsubscribePatternDump();
    };
  }, []);

  return (
    <ThemeProvider defaultTheme="light">
      <DebugProvider>
        <ZoomToast>
          <FocusZoneProvider defaultZone="canvas">
            <HashRouter>
              <Routes>
                <Route path="*" element={<RouteDispatcher />} />
              </Routes>
            </HashRouter>
          </FocusZoneProvider>
        </ZoomToast>
      </DebugProvider>
    </ThemeProvider>
  );
};

export default App;
