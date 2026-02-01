import { useEffect } from "react";

import { useParams } from "react-router-dom";

import { Toolbar } from "@/components/Toolbar";
import { Sidebar } from "@/components/sidebar";
import { getEditor } from "@/store/store";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";

import { EditorView } from "../components/EditorView";

interface EditorProps {
  glyphId?: string;
}

export const Editor = ({ glyphId: glyphIdProp }: EditorProps = {}) => {
  const { glyphId: glyphIdParam } = useParams();
  const glyphId = glyphIdProp ?? glyphIdParam;
  const { activeZone, focusLock } = useFocusZone();

  useEffect(() => {
    const editor = getEditor();
    const toolManager = editor.getToolManager();

    const keyDownHandler = (e: KeyboardEvent) => {
      const canvasActive = activeZone === "canvas" || focusLock || toolManager.isDragging;

      if ((e.key === "=" || e.key === "+") && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        editor.zoomIn();
        editor.requestRedraw();
        return;
      }

      if (e.key === "-" && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        editor.zoomOut();
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

      if (!canvasActive) return;

      for (const { toolId, shortcut } of editor.getToolShortcuts()) {
        if (e.key === shortcut) {
          e.preventDefault();
          editor.setActiveTool(toolId);
          editor.requestRedraw();
          return;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        editor.deleteSelectedPoints();
        return;
      }

      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        editor.selectAll();
        e.preventDefault();
        return;
      }

      toolManager.handleKeyDown(e);
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (activeZone !== "canvas" && !focusLock && !toolManager.isDragging) return;
      toolManager.handleKeyUp(e);
    };

    document.addEventListener("keydown", keyDownHandler);
    document.addEventListener("keyup", keyUpHandler);

    return () => {
      document.removeEventListener("keydown", keyDownHandler);
      document.removeEventListener("keyup", keyUpHandler);
    };
  }, [glyphId, activeZone, focusLock]);

  useEffect(() => {
    const editor = getEditor();
    editor.setZone(activeZone);
  }, [activeZone]);

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
        <ZoneContainer zone="canvas" className="flex-1">
          <EditorView glyphId={glyphId ?? ""} />
        </ZoneContainer>
        <ZoneContainer zone="sidebar">
          <Sidebar />
        </ZoneContainer>
      </div>
    </div>
  );
};
