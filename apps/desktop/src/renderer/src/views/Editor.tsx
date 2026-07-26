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
import { asGlyphId, mintNodeId } from "@shift/types";

export const Editor = () => {
  const { glyphId: glyphIdParam } = useParams();
  const editor = useEditor();
  const glyphId = glyphIdParam ? asGlyphId(glyphIdParam) : null;
  const glyph = glyphId ? editor.glyphForId(glyphId) : null;
  const cursorStyle = useSignalState(editor.cursorCell);
  const gesture = useSignalState(editor.gesture.cell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);

  const { activeZone, claimZone } = useFocusZone();

  useEffect(() => {
    if (!glyph) return;

    claimZone("canvas");
  }, [claimZone, glyph]);

  // GlyphGrid acquires the complete Glyph before navigating. The route only
  // publishes a scene node after synchronous acquisition is confirmed.
  useEffect(() => {
    if (!glyph) return undefined;

    const nodeId = mintNodeId();
    editor.scene.setNodes([
      {
        id: nodeId,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a0",
        glyphId: glyph.id,
        sourceId: editor.activeSourceId ?? editor.font.defaultSource.id,
        position: { x: 0, y: 0 },
      },
    ]);
    editor.editing.enter(nodeId);

    return () => {
      editor.scene.deleteNode(nodeId);
      if (editor.editing.has(nodeId)) editor.editing.clear();
    };
  }, [editor, glyph]);

  useEffect(() => {
    if (!glyph) return;

    const node = editor.scene
      .nodesOfKind("glyph")
      .find((candidate) => candidate.glyphId === glyph.id);
    if (!node) return;

    const sourceId = activeSourceId ?? editor.font.defaultSource.id;
    if (node.sourceId === sourceId) return;

    editor.scene.updateNode({ id: node.id, sourceId });
  }, [activeSourceId, editor, glyph]);

  useEffect(() => {
    if (!glyph) return undefined;

    const toolManager = editor.toolManager;
    const keyboardRouter = new KeyboardRouter(() => ({
      canvasActive: activeZone === "canvas" || toolManager.isDragging,
      activeTool: editor.getActiveTool(),
      editor,
      toolManager,
    }));

    const keyDownHandler = async (e: KeyboardEvent) => {
      try {
        await keyboardRouter.handleKeyDown(e);
      } catch (error) {
        console.error("keyboard keydown failed", error);
      }
    };

    const keyUpHandler = async (e: KeyboardEvent) => {
      try {
        await keyboardRouter.handleKeyUp(e);
      } catch (error) {
        console.error("keyboard keyup failed", error);
      }
    };

    document.addEventListener("keydown", keyDownHandler);
    document.addEventListener("keyup", keyUpHandler);

    return () => {
      document.removeEventListener("keydown", keyDownHandler);
      document.removeEventListener("keyup", keyUpHandler);
    };
  }, [activeZone, editor, glyph]);

  if (!glyph) return null;

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
