import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { DebugProvider } from "@/context/DebugContext";
import { ZoomToast } from "@/components/ZoomToast";
import { isDev } from "@/lib/utils/utils";
import { dumpSelectionPatternsToConsole } from "@/lib/debug/dumpSelectionPatterns";
import { clearDirty, getEditor, setFilePath } from "@/store/store";
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

function parseEditorUnicodeFromHash(hash: string): number | null {
  const match = hash.match(EDITOR_HASH_RE);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 16);
  return Number.isNaN(parsed) ? null : parsed;
}

export const App = () => {
  useEffect(() => {
    const editor = getEditor();
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
        editor.loadFont(filePath);
        editor.updateMetricsFromFont();
        setFilePath(filePath);
        clearDirty();
        documentPersistence.openDocument(filePath);
        didOpenFont = true;
        if (source === "restore") {
          const unicode = parseEditorUnicodeFromHash(window.location.hash);
          if (unicode !== null) {
            const glyphRef = editor.glyphRefFromUnicode(unicode);
            editor.setMainGlyphUnicode(unicode);
            editor.startEditSession(glyphRef);
            editor.setDrawOffsetForGlyph({ x: 0, y: 0 }, glyphRef);
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
          return;
        }

        const exists = await window.electronAPI?.pathsExist([mostRecentPath]);
        if (!exists?.[0]) {
          return;
        }

        handleOpenFont(mostRecentPath, "restore");
      })();
    }

    const unsubscribeOpen = window.electronAPI?.onMenuOpenFont(handleOpenFont);
    const unsubscribeExternalOpen = window.electronAPI?.onExternalOpenFont(handleOpenFont);

    const unsubscribeSave = window.electronAPI?.onMenuSaveFont(async (savePath) => {
      try {
        await editor.saveFontAsync(savePath);
        setFilePath(savePath);
        clearDirty();
        documentPersistence.onDocumentPathChanged(savePath);
        documentPersistence.flushNow();
        await window.electronAPI?.saveCompleted(savePath);
      } catch (error) {
        console.error("Failed to save font:", error);
      }
    });

    const unsubscribePatternDump = window.electronAPI?.onDebugDumpSelectionPatterns(() => {
      dumpSelectionPatternsToConsole();
    });

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      documentPersistence.dispose();
      if (unsubscribeOpen) unsubscribeOpen();
      if (unsubscribeExternalOpen) unsubscribeExternalOpen();
      if (unsubscribeSave) unsubscribeSave();
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
