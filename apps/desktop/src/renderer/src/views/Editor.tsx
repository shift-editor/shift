import { useEffect, type ReactNode } from "react";

import { useParams } from "react-router";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { Toolbar } from "@/components/chrome/Toolbar";
import { useSidebarLayout } from "@/components/chrome/useSidebarLayout";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { Canvas } from "@/components/editor/Canvas";
import { CanvasContextMenu } from "@/components/editor/CanvasContextMenu";
import { useEditor } from "@/workspace/WorkspaceContext";
import { localBounds } from "@shift/editor/spaces";
import { editRunItem, glyphTextItem } from "@shift/editor/text";
import type { NodeTransaction } from "@shift/editor/types";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { KeyboardRouter } from "@/lib/keyboard";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@shift/editor/signals";
import { asGlyphId } from "@shift/types";
import { Bounds } from "@shift/geo";

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

  // GlyphGrid acquires the complete Glyph before navigating. Until pages exist,
  // the canvas has one text run at the scene origin that outlives the route, and
  // opening a glyph replaces the run's text with that glyph and edits it in place.
  useEffect(() => {
    if (!glyph) return undefined;

    const sourceId = editor.activeSourceId ?? editor.font.defaultSource.id;
    let run = editor.scene.nodesOfKind("textRun")[0];
    if (!run) {
      const record = editor.text.createRun([]);
      run = editor.scene.createNode({
        kind: "textRun",
        runId: record.id,
        size: editor.font.metricsCell.peek().unitsPerEm,
        position: { x: 0, y: 0 },
      });
    }
    const textRun = run;
    const previous = editor.nodeDefinition("textRun").childGlyph(textRun);
    const open = (tx: NodeTransaction) => {
      if (previous?.glyphId === glyph.id) {
        tx.enterEditing(previous.id);
        return previous;
      }
      const item = glyphTextItem(glyph.name, glyph.entry.unicodes[0] ?? null);
      editor.text.setItems(textRun.runId, [item]);
      const child = editRunItem(editor, tx, textRun, item.id, sourceId);
      if (child) tx.enterEditing(child.id);
      return child;
    };
    // Route hydration is navigation, never a history entry.
    const node = editor.history.withoutRecording(() => editor.editNodes("Open glyph", open));
    // Tools activate against the glyph node they find, so reset after it is placed.
    editor.toolManager.reset();

    const metrics = editor.font.metricsAtLocation(editor.externalLocation);
    const view = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    const outlineBounds = view.bounds;
    const advance = view.xAdvanceCell.peek();

    const glyphFrameBounds = Bounds.create(
      {
        x: Math.min(0, outlineBounds?.min.x ?? 0),
        y: Math.min(metrics.descender, outlineBounds?.min.y ?? metrics.descender),
      },
      {
        x: Math.max(advance, outlineBounds?.max.x ?? advance),
        y: Math.max(metrics.ascender, outlineBounds?.max.y ?? metrics.ascender),
      },
    );

    if (node) editor.fitInitialBounds(editor.toSceneBounds(node, localBounds(glyphFrameBounds)));

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
    <EditorLayout cursorStyle={cursorStyle} gesture={gesture.phase}>
      <CanvasContextMenu>
        <Canvas />
      </CanvasContextMenu>
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
  const {
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    leftSidebarContentRef,
    rightSidebarContentRef,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useSidebarLayout();

  return (
    <div
      data-testid="editor-shell"
      className="shift-editor-shell flex h-screen w-screen min-w-150 flex-col bg-background"
      data-gesture={gesture}
      style={{ "--shift-cursor": cursorStyle } as React.CSSProperties}
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
