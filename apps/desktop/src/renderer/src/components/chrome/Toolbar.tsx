import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { ToolsPane } from "@/components/editor/ToolsPane";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import { useFont } from "@/workspace/WorkspaceContext";

export const Toolbar = () => {
  const font = useFont();
  const { filename, dirty } = useDocumentChromeState();
  const familyName = font.metadata.familyName;
  const editedFilename = `${filename} — Edited`;

  return (
    <header className="titlebar-drag flex min-h-12 w-screen items-center bg-toolbar py-1 pr-6">
      <Titlebar />
      <div className="flex justify-center items-center gap-6">
        <NavigationPane />
        <div className="flex flex-row justify-center items-center">
          <div>
            <p className="grid whitespace-nowrap text-ui">
              <span className="invisible col-start-1 row-start-1">{editedFilename}</span>
              <span className="col-start-1 row-start-1">{dirty ? editedFilename : filename}</span>
            </p>
            <p className="text-ui font-medium">{familyName}</p>
          </div>
        </div>
      </div>
      <div className="flex-1">
        <ToolsPane />
      </div>
    </header>
  );
};
