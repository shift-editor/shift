import logo from "@/assets/logo@1024.png";
import { Button, Separator } from "@shift/ui";
import { RecentFiles } from "./RecentFiles";
import { Titlebar } from "@/components/chrome/Titlebar";
import { getShiftHost } from "@/host/shiftHost";

export const Landing = () => {
  const host = getShiftHost();

  const handleNewFont = () => {
    void host.workspace
      .create()
      .catch((error) => console.error("creating a new font failed", error));
  };

  const handleOpenFont = () => {
    void host.workspace.open().catch((error) => console.error("opening a font failed", error));
  };

  return (
    <main className="bg-canvas">
      <Titlebar />
      <section className=" flex h-screen flex-col items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 flex-col">
            <img src={logo} alt="Shift" className="h-16 w-16" />
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-primary">
              Shift <span className="ml-[-0.4rem]">.</span>
            </h1>
          </div>
        </div>
        <div className="flex flex-col items-start w-[250px]">
          <Button
            className="w-full flex justify-between items-center"
            onClick={handleNewFont}
            variant="ghost"
          >
            New font
          </Button>
          <Button
            className="w-full flex justify-between items-center"
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
