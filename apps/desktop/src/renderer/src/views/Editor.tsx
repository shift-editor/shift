import { useCallback, useEffect } from "react";

import { useNavigate, useParams } from "react-router-dom";

import { Toolbar } from "@/components/Toolbar";
import { Sidebar } from "@/components/sidebar-right";
import { GlyphFinder } from "@/components/GlyphFinder";
import { getEditor } from "@/store/store";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { useSignalState } from "@/lib/reactive";
import { KeyboardRouter } from "@/lib/keyboard";

import { codepointToHex } from "@/lib/utils/unicode";
import { EditorView } from "../components/EditorView";

interface EditorProps {
  glyphId?: string;
}

export const Editor = ({ glyphId: glyphIdProp }: EditorProps = {}) => {
  const { glyphId: glyphIdParam } = useParams();
  const glyphId = glyphIdProp ?? glyphIdParam;
  const { activeZone } = useFocusZone();
  const navigate = useNavigate();
  const editor = getEditor();
  const glyphFinderOpen = useSignalState(editor.glyphFinderOpen);

  const handleGlyphFinderOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        editor.openGlyphFinder();
      } else {
        editor.closeGlyphFinder();
      }
    },
    [editor],
  );

  const handleGlyphFinderSelect = useCallback(
    (codepoint: number) => {
      if (editor.toolManager.activeToolId === "text") {
        editor.insertTextCodepoint(codepoint);
        editor.recomputeTextRun();
        editor.requestRedraw();
      } else {
        navigate(`/editor/${codepointToHex(codepoint)}`);
      }
      editor.closeGlyphFinder();
    },
    [editor, navigate],
  );

  useEffect(() => {
    const editor = getEditor();
    const toolManager = editor.toolManager;
    const keyboardRouter = new KeyboardRouter(() => ({
      canvasActive: activeZone === "canvas" || toolManager.isDragging,
      activeTool: editor.getActiveTool(),
      editor,
      toolManager,
    }));

    const keyDownHandler = (e: KeyboardEvent) => {
<<<<<<< Updated upstream
      keyboardRouter.handleKeyDown(e);
=======
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

      if (editor.isTextEditing()) {
        toolManager.handleKeyDown(e);
        return;
      }

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
>>>>>>> Stashed changes
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
  }, [glyphId, activeZone]);

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
      <GlyphFinder
        open={glyphFinderOpen}
        onOpenChange={handleGlyphFinderOpenChange}
        onSelect={handleGlyphFinderSelect}
      />
    </div>
  );
};
