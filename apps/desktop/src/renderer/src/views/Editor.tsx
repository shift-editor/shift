import { useEffect, useRef, type ReactNode } from "react";

import { useParams } from "react-router";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { Toolbar } from "@/components/chrome/Toolbar";
import { useSidebarLayout } from "@/components/chrome/useSidebarLayout";
import { useToolbarDock } from "@/components/chrome/useToolbarDock";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { CanvasContextMenu } from "@/components/editor/CanvasContextMenu";
import { useEditor } from "@/workspace/WorkspaceContext";
import { FloatingToolbar } from "@shift/editor/ui";
import { useOpenedGlyph } from "@/context/GlyphCatalogContext";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { KeyboardRouter } from "@/lib/keyboard";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@shift/editor/signals";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { asGlyphId } from "@shift/types";

export const Editor = () => {
  const { glyphId: glyphIdParam } = useParams();
  const editor = useEditor();
  const openedGlyph = useOpenedGlyph();
  const glyphId = glyphIdParam ? asGlyphId(glyphIdParam) : null;
  // Route acquisition publishes openedGlyph after materializing the canonical Glyph.
  const glyph = openedGlyph && glyphId ? editor.glyphForId(glyphId) : null;
  const activeSourceId = useSignalState(editor.activeSourceIdCell);

  const { activeZone, setZone } = useFocusZone();
  // The keyboard router outlives zone changes: rebuilding it would forget a held Space, and its
  // release would then leave the temporary Hand active.
  const activeZoneRef = useRef(activeZone);
  activeZoneRef.current = activeZone;

  useEffect(() => {
    if (!glyph) return;

    setZone("canvas");
  }, [setZone, glyph]);

  // GlyphGrid acquires the complete Glyph before navigating.
  useEffect(() => {
    if (!glyph) return undefined;

    const node = editor.openGlyphInText(glyph.id);
    if (node) editor.fitGlyphFrame(node);

    return () => {
      editor.toolManager.reset();
      editor.selection.clear();
      editor.hover.clear();
      editor.editing.clear();
    };
  }, [editor, glyph]);

  useEffect(() => {
    if (!glyph) return;

    const run = editor.scene.first("textRun");
    const node = run ? editor.nodeDefinition("textRun").childGlyph(run) : null;
    if (!node) return;

    const sourceId = activeSourceId ?? editor.font.defaultSource.id;
    if (node.sourceId === sourceId) return;

    editor.scene.updateNode({ id: node.id, sourceId });
  }, [activeSourceId, editor, glyph]);

  useEffect(() => {
    if (!glyph) return undefined;

    const toolManager = editor.toolManager;
    const keyboardRouter = new KeyboardRouter(
      () => ({
        canvasActive: activeZoneRef.current === "canvas" || editor.isDragging,
        activeTool: editor.tool?.id ?? null,
        editor,
        toolManager,
      }),
      async (commandId) => getShiftHost().commands.run(commandId),
    );

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
  }, [editor, glyph]);

  if (!glyph) return null;

  return (
    <EditorLayout>
      <CanvasContextMenu>
        <Canvas />
      </CanvasContextMenu>
    </EditorLayout>
  );
};

const EditorLayout = ({ children }: { children: ReactNode }) => {
  const editor = useEditor();
  const shellRef = useRef<HTMLDivElement>(null);
  const {
    leftSidebarContentRef,
    rightSidebarContentRef,
    onLayoutChanged,
    sidebarPanelProps,
    toggleLeftSidebar,
    toggleRightSidebar,
    resetLeftSidebar,
    resetRightSidebar,
  } = useSidebarLayout("editor");
  const { dock: toolbarDock, onDockChange: onToolbarDockChange } = useToolbarDock();

  // Cursor and gesture change on every pointer event. Writing them to the shell directly keeps
  // those events from re-rendering the toolbar, sidebars, and canvas beneath it.
  useSignalEffect(() => {
    const cursor = editor.cursorCell.value;
    const phase = editor.gesture.cell.value.phase;
    const shell = shellRef.current;
    if (!shell) return;

    shell.style.setProperty("--shift-cursor", cursor);
    shell.dataset.gesture = phase;
  });

  return (
    <div
      ref={shellRef}
      data-testid="editor-shell"
      className="shift-editor-shell flex h-screen w-screen min-w-150 flex-col bg-background"
    >
      <Toolbar toggleLeftSidebar={toggleLeftSidebar} toggleRightSidebar={toggleRightSidebar} />
      <ResizablePanelGroup
        id="editor-layout-panels"
        orientation="horizontal"
        onLayoutChanged={onLayoutChanged}
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel {...sidebarPanelProps("left")}>
          <div ref={leftSidebarContentRef} className="h-full">
            <ZoneContainer zone="sidebar" className="h-full">
              <LeftSidebar />
            </ZoneContainer>
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize left sidebar"
          inset="start"
          disableDoubleClick
          onDoubleClick={resetLeftSidebar}
        />
        <ResizablePanel id="canvas" minSize={300} data-shift-capture-target="editor">
          <ZoneContainer zone="canvas" className="relative h-full">
            {children}
            <FloatingToolbar
              editor={editor}
              dock={toolbarDock}
              onDockChange={onToolbarDockChange}
            />
          </ZoneContainer>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize right sidebar"
          inset="end"
          disableDoubleClick
          onDoubleClick={resetRightSidebar}
        />
        <ResizablePanel {...sidebarPanelProps("right")}>
          <div ref={rightSidebarContentRef} className="h-full">
            <ZoneContainer zone="sidebar" className="h-full">
              <RightSidebar />
            </ZoneContainer>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
