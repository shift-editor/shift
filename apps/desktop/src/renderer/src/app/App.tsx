import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import { clearDirty, getEditor, setFilePath } from "@/store/store";

import { routes } from "./routes";

export const App = () => {
  useEffect(() => {
    const unsubscribeOpen = window.electronAPI?.onMenuOpenFont((filePath) => {
      const editor = getEditor();
      editor.loadFont(filePath);
      editor.updateMetricsFromFont();
      setFilePath(filePath);
      clearDirty();
    });

    const unsubscribeSave = window.electronAPI?.onMenuSaveFont(
      async (savePath) => {
        try {
          const editor = getEditor();
          editor.saveFont(savePath);
          setFilePath(savePath);
          clearDirty();
          await window.electronAPI?.saveCompleted(savePath);
        } catch (error) {
          console.error("Failed to save font:", error);
        }
      },
    );

    return () => {
      unsubscribeOpen?.();
      unsubscribeSave?.();
    };
  }, []);

  return (
    <ThemeProvider defaultTheme="light">
      <HashRouter>
        <Routes>
          {routes.map((route) => (
            <Route
              key={route.id}
              path={route.path}
              element={<route.component />}
            />
          ))}
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
};

export default App;
