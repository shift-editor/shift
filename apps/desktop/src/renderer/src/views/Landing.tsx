import { LauncherLockup } from "@/app/branding";
import { shiftProductName } from "@/app/release";
import { RecentFiles } from "@/components/launcher/RecentFiles";
import { useRecentDocuments } from "@/components/launcher/useRecentDocuments";
import { Titlebar } from "@/components/chrome/Titlebar";

export const Landing = () => {
  const recentDocuments = useRecentDocuments();

  return (
    <main className="relative flex h-screen flex-col bg-background">
      {/* Overlaid so the launcher centres against the whole window, not the space below the bar. */}
      <div className="absolute inset-x-0 top-0 z-10">
        <Titlebar />
      </div>
      <div className="scrollbar-hidden flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto my-auto flex w-220 max-w-full flex-col gap-20 px-6 py-12">
          <header className="flex justify-center">
            <LauncherLockup aria-hidden="true" className="h-auto w-50 text-primary" />
            <h1 className="sr-only">{shiftProductName}</h1>
          </header>
          {recentDocuments && <RecentFiles documents={recentDocuments} />}
        </div>
      </div>
    </main>
  );
};
