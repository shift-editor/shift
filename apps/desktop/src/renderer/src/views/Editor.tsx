import { useEffect } from "react";

import { useParams } from "react-router-dom";

import { Toolbar } from "@/components/Toolbar";
import { Sidebar } from "@/components/sidebar";
import { getEditor } from "@/store/store";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { KeyboardRouter } from "@/lib/keyboard";

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
    const toolManager = editor.toolManager;
    const keyboardRouter = new KeyboardRouter(() => ({
      canvasActive: activeZone === "canvas" || focusLock || toolManager.isDragging,
      activeTool: editor.getActiveTool(),
      editor,
      toolManager,
    }));

    const keyDownHandler = (e: KeyboardEvent) => {
      keyboardRouter.handleKeyDown(e);
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      keyboardRouter.handleKeyUp(e);
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
    if (!window.electronAPI) return () => {};

    const { onMenuUndo, onMenuRedo, onMenuDelete } = window.electronAPI;

    const unsubscribeUndo = onMenuUndo(() => editor.undo());
    const unsubscribeRedo = onMenuRedo(() => editor.redo());
    const unsubscribeDelete = onMenuDelete(() => {
      editor.deleteSelectedPoints();
    });

    return () => {
      unsubscribeUndo();
      unsubscribeRedo();
      unsubscribeDelete();
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
