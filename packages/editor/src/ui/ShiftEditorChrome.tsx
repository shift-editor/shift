import { useState } from "react";
import type { EditorUISession } from "./types";
import { EditorToolbar } from "./EditorToolbar";
import { FloatingToolbar } from "./FloatingToolbar";
import { GlyphSidebar } from "./GlyphSidebar";
import { ShiftEditor } from "./ShiftEditor";
import { ShiftEditorRoot } from "./ShiftEditorRoot";
import { VariationSidebar } from "./VariationSidebar";

export interface ShiftEditorChromeProps {
  session: EditorUISession;
}

/**
 * Renders the complete editor: title bar, variation sidebar, canvas with the
 * tools floating over it, and glyph sidebar.
 *
 * @remarks
 * Fills its container and owns sidebar visibility. Compose the individual
 * components inside {@link ShiftEditorRoot} for a different layout.
 */
export function ShiftEditorChrome({ session }: ShiftEditorChromeProps) {
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);

  return (
    <ShiftEditorRoot className="shift-editor-shell flex h-full w-full min-w-[600px] flex-col bg-background">
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
          <FloatingToolbar editor={session.editor} />
        </main>
        {rightSidebarOpen ? <GlyphSidebar session={session} /> : null}
      </div>
    </ShiftEditorRoot>
  );
}
