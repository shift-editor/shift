import { useEffect } from "react";

import { useParams } from "react-router-dom";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { Toolbar } from "@/components/chrome/Toolbar";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { KeyboardRouter } from "@/lib/keyboard";
import { useSignalState } from "@/lib/signals";

export const Editor = () => {
  const { glyphId } = useParams();
  const editor = useEditor();
  const cursorStyle = useSignalState(editor.cursorCell);
  const gesture = useSignalState(editor.gesture.cell);

  const { activeZone, claimZone } = useFocusZone();

  useEffect(() => {
    if (!glyphId) return;

    claimZone("canvas");
  }, [glyphId, claimZone]);

  useEffect(() => {
    const toolManager = editor.toolManager;
    const keyboardRouter = new KeyboardRouter(() => ({
      canvasActive: activeZone === "canvas" || toolManager.isDragging,
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
  }, [glyphId, activeZone, editor]);

  if (!glyphId) return null;

  return (
    <div
      className="shift-editor-shell flex h-screen w-screen min-w-[600px] flex-col bg-white"
      data-gesture={gesture.phase}
      style={{ "--shift-cursor": cursorStyle } as React.CSSProperties}
    >
      <Toolbar />
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="shift:editor-layout"
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel
          id="left-sidebar"
          order={1}
          defaultSize={15}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <ZoneContainer zone="sidebar" className="h-full">
            <LeftSidebar />
          </ZoneContainer>
        </ResizablePanel>
        <ResizableHandle inset="start" />
        <ResizablePanel id="canvas" order={2} minSize={30}>
          <ZoneContainer zone="canvas" className="h-full">
            <Canvas />
          </ZoneContainer>
        </ResizablePanel>
        <ResizableHandle inset="end" />
        <ResizablePanel
          id="right-sidebar"
          order={3}
          defaultSize={15}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <ZoneContainer zone="sidebar" className="h-full">
            <RightSidebar />
          </ZoneContainer>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
