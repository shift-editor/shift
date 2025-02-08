import { useEffect } from "react";

import AppState from "@/store/store";

import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";

export const App = () => {
  useEffect(() => {
    const editor = AppState.getState().editor;
    const keyDownHandler = (e: KeyboardEvent) => {
      if (e.key == "=" && e.metaKey) {
        editor.zoomIn();
        editor.requestRedraw();
        return;
      }

      if (e.key == "-" && e.metaKey) {
        editor.zoomOut();
        editor.requestRedraw();
        return;
      }
    };

    document.addEventListener("keydown", keyDownHandler);

    return () => {
      document.removeEventListener("keydown", keyDownHandler);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center">
      <Toolbar />
      <EditorView />
    </div>
  );
};
