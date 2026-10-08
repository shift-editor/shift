import { EditorToolbar } from "@shift/editor/ui";
import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { Separator } from "@shift/ui";
import { WindowControls } from "./WindowControls";
import { WindowMenuBar } from "./WindowMenuBar";
import { getShiftHost } from "@/host/shiftHost";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import type { ToolbarProps } from "@/types/chrome";
import { useFontSession } from "@/workspace/WorkspaceContext";

export const Toolbar = ({ toggleLeftSidebar, toggleRightSidebar }: ToolbarProps) => {
  const session = useFontSession();
  const { filename, dirty } = useDocumentChromeState();
  const isMac = getShiftHost().platform === "darwin";

  return (
    <div className="title-bar-area flex bg-chrome">
      <WindowControls side="start" />
      <div className="min-w-0 flex-1">
        <EditorToolbar
          session={session}
          host={{
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
          }}
          onToggleLeftSidebar={toggleLeftSidebar}
          onToggleRightSidebar={toggleRightSidebar}
        />
      </div>
      <WindowControls side="end" />
    </div>
  );
};
