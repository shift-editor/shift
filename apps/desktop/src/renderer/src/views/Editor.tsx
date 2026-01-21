import { useEffect } from "react";

import { useParams } from "react-router-dom";

import { Toolbar } from "@/components/Toolbar";
import AppState from "@/store/store";

import { EditorView } from "../components/EditorView";

export const Editor = () => {
  const { glyphId } = useParams();

  useEffect(() => {
    const editor = AppState.getState().editor;

    const keyDownHandler = (e: KeyboardEvent) => {
      // Zoom in: Cmd+= OR Cmd+Shift++ (both work)
      if ((e.key === "=" || e.key === "+") && e.metaKey) {
        e.preventDefault();
        editor.zoomIn();
        editor.requestRedraw();
        return;
      }

      // Zoom out: Cmd+-
      if (e.key === "-" && e.metaKey) {
        e.preventDefault();
        editor.zoomOut();
        editor.requestRedraw();
        return;
      }

      if (e.key === "h") {
        e.preventDefault();
        editor.setActiveTool("hand");
        editor.requestRedraw();
        return;
      }

      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        editor.setActiveTool("hand");
        editor.setPreviewMode(true);
        editor.requestRedraw();
        return;
      }

      if (e.key === "p") {
        e.preventDefault();
        editor.setActiveTool("pen");
        editor.requestRedraw();
        return;
      }

      if (e.key === "s") {
        e.preventDefault();
        editor.setActiveTool("shape");
        editor.requestRedraw();
        return;
      }

      if (e.key === "v") {
        e.preventDefault();
        editor.setActiveTool("select");
        editor.requestRedraw();
        return;
      }

      if (e.key === "z" && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
        return;
      }

      if (e.key === "z" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        editor.redo();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        editor.deleteSelectedPoints();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        const activeTool = editor.getActiveTool();
        activeTool.cancel?.();
        editor.requestRedraw();
        return;
      }

      const activeTool = editor.getActiveTool();
      if (activeTool.keyDownHandler) {
        activeTool.keyDownHandler(e);
      }
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (e.key == " ") {
        editor.setActiveTool("select");
        editor.setPreviewMode(false);
        editor.requestRedraw();
      }

      const activeTool = editor.getActiveTool();
      if (activeTool.keyUpHandler) {
        activeTool.keyUpHandler(e);
      }
    };

    document.addEventListener("keydown", keyDownHandler);
    document.addEventListener("keyup", keyUpHandler);

    return () => {
      document.removeEventListener("keydown", keyDownHandler);
      document.removeEventListener("keyup", keyUpHandler);
    };
  }, [glyphId]);

  useEffect(() => {
    const editor = AppState.getState().editor;

    const unsubscribeUndo = window.electronAPI?.onMenuUndo(() => editor.undo());
    const unsubscribeRedo = window.electronAPI?.onMenuRedo(() => editor.redo());
    const unsubscribeDelete = window.electronAPI?.onMenuDelete(() => {
      editor.deleteSelectedPoints();
    });

    return () => {
      unsubscribeUndo?.();
      unsubscribeRedo?.();
      unsubscribeDelete?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-white">
      <Toolbar />
      <EditorView glyphId={glyphId ?? ""} />
    </div>
  );
};
