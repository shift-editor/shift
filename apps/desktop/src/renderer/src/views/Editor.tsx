import { useEffect, useRef, type ReactNode } from "react";

import { useParams } from "react-router";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { Toolbar } from "@/components/chrome/Toolbar";
import { useSidebarLayout } from "@/components/chrome/useSidebarLayout";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { CanvasContextMenu } from "@/components/editor/CanvasContextMenu";
import { useEditor } from "@/workspace/WorkspaceContext";
import type { TextRunNode } from "@shift/editor/types";
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

  const { activeZone, claimZone } = useFocusZone();

  useEffect(() => {
    if (!glyph) return;

    claimZone("canvas");
  }, [claimZone, glyph]);

  // GlyphGrid acquires the complete Glyph before navigating. Until pages exist,
  // the canvas has one text run at the scene origin that outlives the route, and
  // opening a glyph replaces the run's text with that glyph and edits it in place.
  useEffect(() => {
    if (!glyph) return undefined;

    const runs = editor.nodeDefinition("textRun");
    const run =
      editor.scene.nodesOfKind("textRun")[0] ??
      editor.scene.createNode<TextRunNode>({
        kind: "textRun",
        runId: editor.text.createRun([]).id,
        size: editor.font.metricsCell.peek().unitsPerEm,
        position: { x: 0, y: 0 },
      });
    const previous = runs.childGlyph(run);
    const open = () => {
      if (previous?.glyphId === glyph.id) {
        editor.enterNode(previous.id);
        return previous;
      }
      const item = editor.text.glyphItem(glyph.id);
      if (!item) return null;
      editor.text.setItems(run.runId, [item]);
      const child = runs.editItem(run, item.id);
      if (child) editor.enterNode(child.id);
      return child;
    };
    // Route hydration is navigation, never a history entry.
    const node = editor.history.withoutRecording(open);
    // Tools activate against the glyph node they find, so reset after it is placed.
    editor.toolManager.reset();
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

    const run = editor.scene.nodesOfKind("textRun")[0];
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
        canvasActive: activeZone === "canvas" || editor.isDragging,
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
  }, [activeZone, editor, glyph]);

  if (!glyph) return null;

  return (
    <EditorLayout>
      <CanvasContextMenu>
        <Canvas />
      </CanvasContextMenu>
    </EditorLayout>
  );
};

const LEFT_SIDEBAR_DEFAULT_SIZE = 15;
const RIGHT_SIDEBAR_DEFAULT_SIZE = 15;

const EditorLayout = ({ children }: { children: ReactNode }) => {
  const editor = useEditor();
  const shellRef = useRef<HTMLDivElement>(null);
  const {
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    leftSidebarContentRef,
    rightSidebarContentRef,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useSidebarLayout();

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
        data-testid="editor-layout-panels"
        direction="horizontal"
        autoSaveId="shift:editor-layout"
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel
          ref={leftSidebarPanelRef}
          className="sidebar-panel"
          data-testid="left-sidebar-panel"
          id="left-sidebar"
          order={1}
          defaultSize={LEFT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
          <div ref={leftSidebarContentRef} className="h-full">
            <ZoneContainer zone="sidebar" className="h-full">
              <LeftSidebar />
            </ZoneContainer>
          </div>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize left sidebar"
          inset="start"
          onDoubleClick={() => leftSidebarPanelRef.current?.resize(LEFT_SIDEBAR_DEFAULT_SIZE)}
        />
        <ResizablePanel id="canvas" order={2} minSize={30} data-shift-capture-target="editor">
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
          className="sidebar-panel"
          data-testid="right-sidebar-panel"
          id="right-sidebar"
          order={3}
          defaultSize={RIGHT_SIDEBAR_DEFAULT_SIZE}
          minSize={10}
          maxSize={30}
          collapsible
          collapsedSize={0}
        >
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
