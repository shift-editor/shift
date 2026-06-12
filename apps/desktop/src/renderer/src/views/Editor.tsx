import { useCallback, useEffect } from "react";

import { useNavigate, useParams } from "react-router-dom";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@shift/ui";
import { Toolbar } from "@/components/chrome/Toolbar";
import { LeftSidebar } from "@/components/editor/LeftSidebar";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { GlyphFinder } from "@/components/editor/GlyphFinder";
import { EditorView } from "@/components/editor/EditorView";
import { getEditor } from "@/store/appStore";
import { useFocusZone, ZoneContainer } from "@/context/FocusZoneContext";
import { useSignalState } from "@/lib/signals";
import { KeyboardRouter } from "@/lib/keyboard";

import { codepointToHex } from "@/lib/utils/unicode";
import type { GlyphName } from "@shift/types";

export const Editor = () => {
  const { glyphId, glyphName } = useParams();
  const editor = getEditor();

  const { activeZone } = useFocusZone();

  const navigate = useNavigate();
  const glyphFinderOpen = useSignalState(editor.glyphFinderOpenCell);

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
  }, [glyphId, glyphName, activeZone]);

  useEffect(() => {
    const editor = getEditor();
    editor.setZone(activeZone);
  }, [activeZone]);

  if (!glyphId && !glyphName) return null;

  return (
    <div className="flex h-screen w-screen min-w-[600px] flex-col bg-white">
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
            <EditorView glyphId={glyphId} glyphName={glyphName as GlyphName | undefined} />
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
      <GlyphFinder
        open={glyphFinderOpen}
        onOpenChange={handleGlyphFinderOpenChange}
        onSelect={handleGlyphFinderSelect}
      />
    </div>
  );
};
