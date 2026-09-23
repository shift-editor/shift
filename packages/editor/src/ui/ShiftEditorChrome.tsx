import { TooltipProvider } from "@shift/ui";
import { useState } from "react";
import type { EditorUISession } from "./types";
import { EditorToolbar } from "./EditorToolbar";
import { GlyphSidebar } from "./GlyphSidebar";
import { ShiftEditor } from "./ShiftEditor";
import { VariationSidebar } from "./VariationSidebar";

export interface ShiftEditorChromeProps {
  session: EditorUISession;
}

export function ShiftEditorChrome({ session }: ShiftEditorChromeProps) {
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  return (
    <TooltipProvider>
      <div className="shift-editor-chrome shift-editor-shell flex h-full w-full min-w-[600px] flex-col bg-white">
        <EditorToolbar
          session={session}
          leftSidebarOpen={leftSidebarOpen}
          rightSidebarOpen={rightSidebarOpen}
          onToggleLeftSidebar={() => setLeftSidebarOpen((open) => !open)}
          onToggleRightSidebar={() => setRightSidebarOpen((open) => !open)}
        />
        <div
          className="shift-editor-chrome__workspace flex-1 overflow-hidden"
          data-left-sidebar={leftSidebarOpen}
          data-right-sidebar={rightSidebarOpen}
        >
          {leftSidebarOpen ? <VariationSidebar session={session} /> : null}
          <main className="shift-editor-chrome__canvas">
            <ShiftEditor session={session} />
          </main>
          {rightSidebarOpen ? <GlyphSidebar session={session} /> : null}
        </div>
      </div>
    </TooltipProvider>
  );
}
