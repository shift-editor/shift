import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { DebugProvider } from "@/context/DebugContext";
import { ZoomToast } from "@/components/ZoomToast";
import { clearDirty, getEditor, setFilePath } from "@/store/store";
import { documentPersistence } from "@/persistence";

import { RouteDispatcher } from "./RouteDispatcher";

const HOME_HASH = "#/home";

function navigateToHome(): void {
  if (window.location.hash !== HOME_HASH) {
    window.location.hash = HOME_HASH;
  }
}

export const App = () => {
  useEffect(() => {
    const editor = getEditor();
    documentPersistence.init(editor);

    const handleBeforeUnload = () => {
      documentPersistence.flushNow();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const handleOpenFont = (filePath: string) => {
      try {
        editor.loadFont(filePath);
        editor.updateMetricsFromFont();
        setFilePath(filePath);
        clearDirty();
        documentPersistence.openDocument(filePath);
        navigateToHome();
      } catch (error) {
        console.error("Failed to load font:", error);
      }
    };

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

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      documentPersistence.dispose();
      unsubscribeOpen?.();
      unsubscribeExternalOpen?.();
      unsubscribeSave?.();
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
