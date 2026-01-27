import { useEffect } from "react";

import { useParams } from "react-router-dom";

import { Toolbar } from "@/components/Toolbar";
import { Sidebar } from "@/components/sidebar";
import { getEditor } from "@/store/store";

import { EditorView } from "../components/EditorView";

export const Editor = () => {
  const { glyphId } = useParams();

  useEffect(() => {
    const editor = getEditor();
    const toolManager = editor.getToolManager();

    const keyDownHandler = (e: KeyboardEvent) => {
      if ((e.key === "=" || e.key === "+") && e.metaKey) {
        e.preventDefault();
        editor.zoomIn();
        editor.requestRedraw();
        return;
      }

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

      if (e.key === "v" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        editor.setActiveTool("select");
        editor.requestRedraw();
        return;
      }

      if (e.key === "c" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        editor.copy();
        return;
      }

      if (e.key === "x" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        editor.cut();
        return;
      }

      if (e.key === "v" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        editor.paste();
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

      toolManager.handleKeyDown(e);
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      toolManager.handleKeyUp(e);
    };

    document.addEventListener("keydown", keyDownHandler);
    document.addEventListener("keyup", keyUpHandler);

    return () => {
      document.removeEventListener("keydown", keyDownHandler);
      document.removeEventListener("keyup", keyUpHandler);
    };
  }, [glyphId]);

  useEffect(() => {
    const editor = getEditor();

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
    <div className="flex h-screen w-screen flex-col bg-white">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <EditorView glyphId={glyphId ?? ""} />
        <Sidebar />
      </div>
    </div>
  );
};
