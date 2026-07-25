import { useEffect, useState } from "react";

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
import type { Glyph } from "@/lib/model/Glyph";
import { asGlyphId, mintNodeId, type GlyphId, type NodeId } from "@shift/types";

export const Editor = () => {
  const { glyphId } = useParams();
  if (!glyphId) return null;

  return <GlyphEditor key={glyphId} glyphId={asGlyphId(glyphId)} />;
};

const GlyphEditor = ({ glyphId }: { readonly glyphId: GlyphId }) => {
  const editor = useEditor();
  const [glyph, setGlyph] = useState<Glyph | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const cursorStyle = useSignalState(editor.cursorCell);
  const gesture = useSignalState(editor.gesture.cell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);

  const { activeZone, claimZone } = useFocusZone();

  useEffect(() => {
    claimZone("canvas");
  }, [claimZone]);

  useEffect(() => {
    let cancelled = false;
    let placedNodeId: NodeId | null = null;
    editor.scene.clear();

    async function loadRouteGlyph(): Promise<void> {
      try {
        const loadedGlyph = await editor.font.loadGlyph(glyphId);
        if (cancelled) return;

        const nodeId = mintNodeId();
        editor.scene.setNodes([
          {
            id: nodeId,
            type: "node",
            kind: "glyph",
            parentId: null,
            index: "a0",
            glyphId: loadedGlyph.id,
            sourceId: editor.activeSourceId ?? editor.font.defaultSource.id,
            position: { x: 0, y: 0 },
          },
        ]);
        placedNodeId = nodeId;
        editor.editing.enter(nodeId);
        setGlyph(loadedGlyph);
      } catch (error) {
        if (cancelled) return;

        console.error("editor glyph failed to load", error);

        if (placedNodeId) {
          editor.scene.deleteNode(placedNodeId);
          if (editor.editing.has(placedNodeId)) editor.editing.clear();
          placedNodeId = null;
        }

        setLoadFailed(true);
      }
    }

    void loadRouteGlyph();

    return () => {
      cancelled = true;
      if (!placedNodeId) return;

      editor.scene.deleteNode(placedNodeId);
      if (editor.editing.has(placedNodeId)) editor.editing.clear();
    };
  }, [editor, glyphId]);

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

  if (!glyph) {
    return (
      <main
        aria-live="polite"
        className="grid h-screen place-items-center bg-canvas text-sm text-primary"
      >
        {loadFailed ? "Glyph failed to load." : "Loading glyph…"}
      </main>
    );
  }

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
