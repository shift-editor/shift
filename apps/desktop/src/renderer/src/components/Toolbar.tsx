import { NavigationPane } from "./NavigationPane";
import { Titlebar } from "./Titlebar";
import { ToolsPane } from "./ToolsPane";

export const Toolbar = () => {
  return (
    <header className="titlebar-drag flex min-h-12 w-screen items-center border-line border-b bg-toolbar py-1">
      <Titlebar />
      <NavigationPane />
      <ToolsPane />
      <div className="flex-1" />
    </header>
  );
};
