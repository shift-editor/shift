import { useEffect } from "react";
import { LauncherLockup } from "@/app/branding";
import { shiftProductName } from "@/app/release";
import { HelpMenu } from "@/components/launcher/HelpMenu";
import { LauncherActions } from "@/components/launcher/LauncherActions";
import { RecentFiles } from "@/components/launcher/RecentFiles";
import { UpdateStrip } from "@/components/chrome/UpdateStrip";
import { useRecentDocuments } from "@/components/launcher/useRecentDocuments";
import { WindowControls } from "@/components/chrome/WindowControls";
import { WindowMenuBar } from "@/components/chrome/WindowMenuBar";
import { getShiftHost } from "@/host/shiftHost";

export const Landing = () => {
  const recentDocuments = useRecentDocuments();
  const recentsLoaded = recentDocuments !== null;

  useEffect(() => {
    if (!recentsLoaded) return undefined;

    // Wait for the frame with the recent files to paint before main shows the window.
    const frame = requestAnimationFrame(() => {
      void signalReady();
    });
    return () => cancelAnimationFrame(frame);
  }, [recentsLoaded]);

  const isMac = getShiftHost().platform === "darwin";

  return (
    <main className="relative flex h-screen flex-col bg-background text-primary">
      {isMac ? (
        // macOS draws the traffic lights (systemTrafficLights in main); this strip
        // only drags the window. Overlaid so the launcher centres against the
        // whole window, not the space below the bar.
        <div className="titlebar-drag absolute inset-x-0 top-0 z-10 h-10" />
      ) : (
        <div className="title-bar-area shrink-0 bg-chrome">
          <div className="titlebar-drag flex h-10 items-center">
            <WindowControls side="start" />
            <WindowMenuBar />
            <div className="flex-1" />
            <WindowControls side="end" />
          </div>
        </div>
      )}
      <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-200 flex-col pb-20">
          <header className="flex items-center gap-2 pt-25 pb-14">
            <div className="min-w-0 flex-1">
              <LauncherLockup aria-hidden="true" className="h-9 w-auto text-primary" />
              <h1 className="sr-only">{shiftProductName}</h1>
            </div>
            <LauncherActions />
          </header>
          {recentDocuments && <RecentFiles documents={recentDocuments} />}
        </div>
      </div>
      <UpdateStrip className="inset-x-0 bottom-3.5 justify-center" />
      <HelpMenu className="absolute right-3.5 bottom-3.5" />
    </main>
  );
};

async function signalReady(): Promise<void> {
  try {
    await getShiftHost().window.ready();
  } catch (error) {
    console.error("signalling launcher readiness failed", error);
  }
}
