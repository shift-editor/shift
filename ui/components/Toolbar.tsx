import { NavigationPane } from './NavigationPane';
import { ToolsPane } from './ToolsPane';

export const Toolbar = () => {
  return (
    <main className="flex min-h-16 w-screen items-center justify-center bg-[#2d2d2d]">
      <NavigationPane />
      <ToolsPane />
      <div className="flex-1" />
    </main>
  );
};
