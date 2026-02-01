import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { FocusZoneProvider } from "@/context/FocusZoneContext";
import { DebugProvider } from "@/context/DebugContext";
import { ZoomToast } from "@/components/ZoomToast";
import { clearDirty, getEditor, setFilePath } from "@/store/store";

import { RouteDispatcher } from "./RouteDispatcher";

export const App = () => {
  useEffect(() => {
    const unsubscribeOpen = window.electronAPI?.onMenuOpenFont((filePath) => {
      const editor = getEditor();
      editor.loadFont(filePath);
      editor.updateMetricsFromFont();
      setFilePath(filePath);
      clearDirty();
    });

    const unsubscribeSave = window.electronAPI?.onMenuSaveFont(async (savePath) => {
      try {
        const editor = getEditor();
        await editor.saveFontAsync(savePath);
        setFilePath(savePath);
        clearDirty();
        await window.electronAPI?.saveCompleted(savePath);
      } catch (error) {
        console.error("Failed to save font:", error);
      }
    });

    return () => {
      unsubscribeOpen?.();
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
