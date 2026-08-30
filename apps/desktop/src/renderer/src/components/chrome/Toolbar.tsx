import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { ToolsPane } from "@/components/editor/ToolsPane";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import { useSignalState } from "@/lib/signals";
import { useFont } from "@/workspace/WorkspaceContext";

export const Toolbar = () => {
  const font = useFont();
  const metadata = useSignalState(font.metadataCell);
  const { filename, dirty } = useDocumentChromeState();
  const editedFilename = `${filename} — Edited`;

  return (
    <header className="titlebar-drag grid h-[50px] w-screen grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-toolbar">
      <div className="flex min-w-0 items-center">
        <Titlebar />
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
      <div aria-hidden="true" />
    </header>
  );
};
