import { EditorToolbar } from "@shift/editor/ui";
import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import type { ToolbarProps } from "@/types/chrome";
import { useFontSession } from "@/workspace/WorkspaceContext";

export const Toolbar = ({ toggleLeftSidebar, toggleRightSidebar }: ToolbarProps) => {
  const session = useFontSession();
  const { filename, dirty } = useDocumentChromeState();

  return (
    <EditorToolbar
      session={session}
      host={{
        documentTitle: filename,
        documentEdited: dirty,
        navigation: <NavigationPane />,
        windowControls: <Titlebar />,
      }}
      onToggleLeftSidebar={toggleLeftSidebar}
      onToggleRightSidebar={toggleRightSidebar}
    />
  );
};
