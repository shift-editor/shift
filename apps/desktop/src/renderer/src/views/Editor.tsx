import { useEffect, useRef, type ReactNode } from "react";

import { useParams } from "react-router";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelHandle,
} from "@shift/ui";
import { Toolbar } from "@/components/chrome/Toolbar";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { KeyboardRouter } from "@/lib/keyboard";
import { useSignalState } from "@/lib/signals";
import { asGlyphId, mintNodeId } from "@shift/types";

export const Editor = () => {
  const { glyphId: glyphIdParam } = useParams();
  const editor = useEditor();
  const { openedGlyph } = useGlyphCatalog();
  const glyphId = glyphIdParam ? asGlyphId(glyphIdParam) : null;
  // Route acquisition publishes openedGlyph after materializing the canonical Glyph.
  const glyph = openedGlyph && glyphId ? editor.glyphForId(glyphId) : null;
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
    editor.toolManager.reset();

    return () => {
      editor.toolManager.reset();
      editor.selection.clear();
      editor.hover.clear();
      if (editor.editing.has(nodeId)) editor.editing.clear();
      editor.scene.deleteNode(nodeId);
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
      canvasActive: activeZone === "canvas" || editor.isDragging,
      activeTool: editor.tool?.id ?? null,
      editor,
      toolManager,
    }));

    const keyDownHandler = async (event: KeyboardEvent) => {
      try {
        await keyboardRouter.handleKeyDown(event);
      } catch (error) {
        console.error("keyboard keydown failed", error);
      }
    };

    const keyUpHandler = async (event: KeyboardEvent) => {
      try {
        await keyboardRouter.handleKeyUp(event);
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
    <EditorLayout cursorStyle={cursorStyle} gesture={gesture.phase}>
      <Canvas />
    </EditorLayout>
  );
};

const LEFT_SIDEBAR_DEFAULT_SIZE = 15;
const RIGHT_SIDEBAR_DEFAULT_SIZE = 15;

const EditorLayout = ({
  cursorStyle,
  gesture,
  children,
}: {
  cursorStyle: string;
  gesture: string;
  children: ReactNode;
}) => {
  const leftSidebarPanelRef = useRef<ResizablePanelHandle>(null);
  const rightSidebarPanelRef = useRef<ResizablePanelHandle>(null);

  return (
    <div
      data-testid="editor-shell"
      className="shift-editor-shell flex h-screen w-screen min-w-[600px] flex-col bg-white"
      data-gesture={gesture}
      style={{ "--shift-cursor": cursorStyle } as React.CSSProperties}
    >
      <Toolbar />
      <ResizablePanelGroup
        data-testid="editor-layout-panels"
        direction="horizontal"
        autoSaveId="shift:editor-layout"
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel
          ref={leftSidebarPanelRef}
          data-testid="left-sidebar-panel"
          id="left-sidebar"
          order={1}
          defaultSize={LEFT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <ZoneContainer zone="sidebar" className="h-full">
            <LeftSidebar />
          </ZoneContainer>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize left sidebar"
          inset="start"
          onDoubleClick={() => leftSidebarPanelRef.current?.resize(LEFT_SIDEBAR_DEFAULT_SIZE)}
        />
        <ResizablePanel id="canvas" order={2} minSize={30}>
          <ZoneContainer zone="canvas" className="h-full">
            {children}
          </ZoneContainer>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize right sidebar"
          inset="end"
          onDoubleClick={() => rightSidebarPanelRef.current?.resize(RIGHT_SIDEBAR_DEFAULT_SIZE)}
        />
        <ResizablePanel
          ref={rightSidebarPanelRef}
          data-testid="right-sidebar-panel"
          id="right-sidebar"
          order={3}
          defaultSize={RIGHT_SIDEBAR_DEFAULT_SIZE}
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
