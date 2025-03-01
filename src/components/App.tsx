import { useEffect } from "react";

import AppState from "@/store/store";

import { EditorView } from "./EditorView";
import { Toolbar } from "./Toolbar";

export const App = () => {
  useEffect(() => {
    const editor = AppState.getState().editor;
    const switchTool = AppState.getState().setActiveTool;

    // TODO: Make tool specific key handlers
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

      if (e.key == " ") {
        switchTool("hand");
        editor.setFillContour(true);
        editor.requestRedraw();
      }
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (e.key == " ") {
        switchTool("select");
        editor.setFillContour(false);
        editor.requestRedraw();
      }
    };

    document.addEventListener("keydown", keyDownHandler);
    document.addEventListener("keyup", keyUpHandler);

    return () => {
      document.removeEventListener("keydown", keyDownHandler);
      document.removeEventListener("keydown", keyUpHandler);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center">
      <Toolbar />
      <EditorView />
    </div>
  );
};
