import { useEffect } from "react";
import { LauncherLockup } from "@/app/branding";
import { shiftProductName } from "@/app/release";
import { RecentFiles } from "@/components/launcher/RecentFiles";
import { useRecentDocuments } from "@/components/launcher/useRecentDocuments";
import { Titlebar } from "@/components/chrome/Titlebar";
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

  return (
    <main className="relative flex h-screen flex-col bg-background">
      {/* Overlaid so the launcher centres against the whole window, not the space below the bar. */}
      <div className="absolute inset-x-0 top-0 z-10">
        <Titlebar />
      </div>
      <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-200 max-w-full flex-col gap-20 px-6 pt-20 pb-20">
          <header className="flex justify-center">
            <LauncherLockup aria-hidden="true" className="h-auto w-44 text-primary" />
            <h1 className="sr-only">{shiftProductName}</h1>
          </header>
          {recentDocuments && <RecentFiles documents={recentDocuments} />}
        </div>
      </div>
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
