import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import SidebarLeftSvg from "@assets/general/sidebar-left.svg";
import SidebarRightSvg from "@assets/general/sidebar-right.svg";
import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { ToolsPane } from "@/components/editor/ToolsPane";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import { useSignalState } from "@shift/editor/signals";
import { useFont } from "@/workspace/WorkspaceContext";
import type { ToolbarProps } from "@/types/chrome";

export const Toolbar = ({ toggleLeftSidebar, toggleRightSidebar }: ToolbarProps) => {
  const font = useFont();
  const metadata = useSignalState(font.metadataCell);
  const { filename, dirty } = useDocumentChromeState();
  const editedFilename = `${filename} — Edited`;

  return (
    <header className="titlebar-drag grid h-[50px] w-screen grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-toolbar">
      <div className="flex min-w-0 items-center">
        <Titlebar />
        <Tooltip>
          <TooltipTrigger>
            <Button
              icon={<SidebarLeftSvg width={20} height={20} />}
              aria-label="Toggle left sidebar"
              variant="ghost"
              size="icon"
              className="text-sidebar-icon hover:bg-icon-button-hover"
              onClick={toggleLeftSidebar}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle left sidebar</TooltipContent>
        </Tooltip>
        <div className="flex items-center justify-center gap-6">
          <NavigationPane />
          <div className="flex items-center justify-center">
            <div>
              <p className="grid whitespace-nowrap text-ui">
                <span className="invisible col-start-1 row-start-1">{editedFilename}</span>
                <span className="col-start-1 row-start-1">{dirty ? editedFilename : filename}</span>
              </p>
              <p className="text-ui font-medium">{metadata.familyName ?? "Untitled"}</p>
            </div>
          </div>
        </div>
      </div>
      <ToolsPane />
      <div className="flex justify-end pr-2">
        <Tooltip>
          <TooltipTrigger>
            <Button
              icon={<SidebarRightSvg width={20} height={20} />}
              aria-label="Toggle right sidebar"
              variant="ghost"
              size="icon"
              className="text-sidebar-icon hover:bg-icon-button-hover"
              onClick={toggleRightSidebar}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle right sidebar</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
};
