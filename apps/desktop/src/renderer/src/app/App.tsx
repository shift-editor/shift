import "./App.css";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/context/ThemeContext";
import AppState from "@/store/store";

import { routes } from "./routes";

export const App = () => {
  useEffect(() => {
    const editor = AppState.getState().editor;
    editor.startEditSession(65);
    AppState.getState().setFilePath(null);
    AppState.getState().clearDirty();
  }, []);

  useEffect(() => {
    const unsubscribeOpen = window.electronAPI?.onMenuOpenFont((filePath) => {
      const editor = AppState.getState().editor;
      editor.loadFont(filePath);
      editor.updateMetricsFromFont();
      AppState.getState().setFilePath(filePath);
      AppState.getState().clearDirty();
    });

    const unsubscribeSave = window.electronAPI?.onMenuSaveFont(
      async (savePath) => {
        try {
          const editor = AppState.getState().editor;
          editor.saveFont(savePath);
          AppState.getState().setFilePath(savePath);
          AppState.getState().clearDirty();
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
