import LauncherLogo from "@/assets/launcher-logo.svg";
import { Button, Separator } from "@shift/ui";
import { RecentFiles } from "./RecentFiles";
import { Titlebar } from "@/components/chrome/Titlebar";
import { getShiftHost } from "@/host/shiftHost";

export const Landing = () => {
  const host = getShiftHost();

  const handleNewFont = async () => {
    try {
      await host.commands.run("file.new");
    } catch (error) {
      console.error("new font failed", error);
    }
  };

  const handleOpenFont = async () => {
    try {
      await host.commands.run("file.open");
    } catch (error) {
      console.error("opening a font failed", error);
    }
  };

  return (
    <main className="bg-canvas">
      <Titlebar />
      <section className=" flex h-screen flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <LauncherLogo aria-hidden="true" className="h-auto w-[240px] text-primary" />
          <h1 className="sr-only">Shift</h1>
        </div>
        <div className="flex flex-col items-start w-[200px]">
          <Button
            className="w-full flex justify-between items-center font-medium"
            onClick={handleNewFont}
            variant="ghost"
          >
            New font
          </Button>
          <Button
            className="w-full flex justify-between items-center font-medium"
            onClick={handleOpenFont}
            variant="ghost"
          >
            Load font
            <span className="text-sm font-medium text-muted">⌘ + o</span>
          </Button>
        </div>
        <div className="flex flex-col gap-4 mt-4">
          <Separator className="bg-secondary/30" />
          <RecentFiles onOpenFile={() => {}} />
        </div>
      </section>
    </main>
  );
};
