import { memo, useMemo } from "react";
import { EditorToolbar, type EditorToolbarHost } from "@shift/editor/ui";
import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { Separator } from "@shift/ui";
import { WindowControls } from "./WindowControls";
import { WindowMenuBar } from "./WindowMenuBar";
import { getShiftHost } from "@/host/shiftHost";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import type { ToolbarProps } from "@/types/chrome";
import { useFontSession } from "@/workspace/WorkspaceContext";

// Document status signals update during edits and scrubs. Memoizing the toolbar
// keeps its tools, menus, and window controls from re-rendering with them when
// the title, edited flag, and sidebar toggles have not actually changed.
const MemoizedEditorToolbar = memo(EditorToolbar);

export const Toolbar = ({ toggleLeftSidebar, toggleRightSidebar }: ToolbarProps) => {
  const session = useFontSession();
  const { filename, dirty } = useDocumentChromeState();
  const isMac = getShiftHost().platform === "darwin";

  const host = useMemo<EditorToolbarHost>(
    () => ({
      documentTitle: filename,
      documentEdited: dirty,
      navigation: <NavigationPane />,
      windowControls: <Titlebar />,
      ...(isMac
        ? {}
        : {
            menuBar: (
              <>
                <WindowMenuBar collapsible />
                <Separator orientation="vertical" variant="strong" className="mx-2 h-4" />
              </>
            ),
          }),
    }),
    [dirty, filename, isMac],
  );

  return (
    // EditorToolbar paints its own chrome background. Painting the row as well
    // doubled translucent theme colours (Dracula, Nord), so only the window
    // control slots beside it get one.
    <div className="title-bar-area flex">
      <div className="flex bg-chrome">
        <WindowControls side="start" />
      </div>
      <div className="min-w-0 flex-1">
        <MemoizedEditorToolbar
          session={session}
          host={host}
          onToggleLeftSidebar={toggleLeftSidebar}
          onToggleRightSidebar={toggleRightSidebar}
        />
      </div>
      <div className="flex bg-chrome">
        <WindowControls side="end" />
      </div>
    </div>
  );
};
