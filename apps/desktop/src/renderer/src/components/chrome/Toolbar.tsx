import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { ToolsPane } from "@/components/editor/ToolsPane";
import { useDocumentChromeState } from "@/hooks/useDocumentChromeState";
import { useSignalState } from "@/lib/signals";
import { useFont, useFontSession } from "@/workspace/WorkspaceContext";

export const Toolbar = () => (
  <header className="titlebar-drag flex min-h-12 w-screen items-center bg-toolbar py-1 pr-6">
    <Titlebar />
    <div className="flex justify-center items-center gap-6">
      <NavigationPane />
      <ToolbarTitle />
    </div>
    <div className="flex-1">
      <ToolsPane />
    </div>
  </header>
);

const ToolbarTitle = () => {
  const workspace = useFontSession().workspace;

  return workspace ? <AuthoredToolbarTitle /> : <DisplayToolbarTitle />;
};

const AuthoredToolbarTitle = () => {
  const font = useFont();
  const { filename, dirty } = useDocumentChromeState();
  const editedFilename = `${filename} — Edited`;

  return (
    <ToolbarTitleContent
      title={dirty ? editedFilename : filename}
      measuredTitle={editedFilename}
      familyName={font.metadata.familyName ?? "Untitled"}
    />
  );
};

const DisplayToolbarTitle = () => {
  const catalog = useFontSession().catalog;
  const familyName = useSignalState(catalog.familyNameCell) ?? "Untitled";
  const styleName = useSignalState(catalog.styleNameCell) ?? "Preview";

  return (
    <ToolbarTitleContent title={styleName} measuredTitle={styleName} familyName={familyName} />
  );
};

const ToolbarTitleContent = ({
  title,
  measuredTitle,
  familyName,
}: {
  title: string;
  measuredTitle: string;
  familyName: string;
}) => (
  <div className="flex flex-row justify-center items-center">
    <div>
      <p className="grid whitespace-nowrap text-ui">
        <span className="invisible col-start-1 row-start-1">{measuredTitle}</span>
        <span className="col-start-1 row-start-1">{title}</span>
      </p>
      <p className="text-ui font-medium">{familyName}</p>
    </div>
  </div>
);
