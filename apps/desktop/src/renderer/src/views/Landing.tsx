import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo@1024.png";
import { Button, Separator } from "@shift/ui";
import { RecentFiles } from "./RecentFiles";
import { Titlebar } from "@/components/chrome/Titlebar";
import { shiftHost } from "@/host/shiftHost";
import { getFont, getWorkspace } from "@/store/appStore";
import { useSignalState } from "@/lib/signals/useSignal";

export const Landing = () => {
  const navigate = useNavigate();
  const loaded = useSignalState(getFont().$loaded);

  useEffect(() => {
    if (!loaded) return;

    navigate("/home");
    void shiftHost.commands.run("window.maximise");
  }, [loaded, navigate]);

  const handleNewFont = () => {
    getWorkspace()
      .create()
      .catch((error) => console.error("creating a new font failed", error));
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
            <span className="text-sm font-medium text-muted">⌘ + n</span>
          </Button>
          <Button className="w-full flex justify-between items-center" disabled variant="ghost">
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
