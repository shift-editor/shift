import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Button, Progress } from "@shift/ui";
import { appIcon } from "@/app/branding";
import { shiftProductName } from "@/app/release";
import { Titlebar } from "@/components/chrome/Titlebar";
import { getShiftHost } from "@/host/shiftHost";
import type { UpdateProgress } from "@shared/update/types";

const INITIAL_PROGRESS: UpdateProgress = {
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
};

export const UpdateScreen = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const initialState = query.get("state");
  const [view, setView] = useState<"available" | "downloading" | "ready">(
    initialState === "available" || initialState === "ready" ? initialState : "downloading",
  );
  const [version, setVersion] = useState(query.get("version") ?? "");
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const host = getShiftHost();

  useEffect(() => {
    const unsubscribeAvailable = host.update.onAvailable((availableVersion) => {
      setVersion(availableVersion);
      setView("available");
    });
    const unsubscribeProgress = host.update.onProgress((nextProgress) => {
      setProgress(nextProgress);
      setView("downloading");
    });
    const unsubscribeReady = host.update.onReady((readyVersion) => {
      setVersion(readyVersion);
      setView("ready");
    });

    return () => {
      unsubscribeAvailable();
      unsubscribeProgress();
      unsubscribeReady();
    };
  }, [host]);

  const startDownload = async () => {
    try {
      await host.update.startDownload();
    } catch (error) {
      console.error("update download failed to start", error);
    }
  };

  const cancelDownload = async () => {
    try {
      await host.update.cancelDownload();
    } catch (error) {
      console.error("update cancellation failed", error);
    }
  };

  const restartToUpdate = async () => {
    try {
      await host.update.restartToUpdate();
    } catch (error) {
      console.error("update restart failed", error);
    }
  };

  const later = async () => {
    try {
      await host.update.later();
    } catch (error) {
      console.error("closing the update prompt failed", error);
    }
  };

  const progressText =
    progress.total > 0
      ? `Downloading update… ${formatBytes(progress.transferred)} of ${formatBytes(progress.total)}`
      : "Preparing download…";

  let content;
  switch (view) {
    case "available":
      content = (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-base font-semibold">
              {shiftProductName} {version} is available.
            </h1>
            <p className="text-sm text-secondary">Would you like to download it now?</p>
          </div>
          <div className="flex gap-2.5">
            <Button variant="primary" className="min-w-36" onClick={startDownload}>
              Download Update
            </Button>
            <Button className="min-w-24" onClick={later}>
              Later
            </Button>
          </div>
        </>
      );
      break;
    case "downloading":
      content = (
        <>
          <h1 className="text-base font-semibold">{progressText}</h1>
          <Progress
            aria-label="Update download progress"
            aria-valuetext={progressText}
            value={progress.percent}
            className="w-full"
            trackClassName="bg-secondary/30"
            indicatorClassName="duration-200"
          />
          <Button className="min-w-24" onClick={cancelDownload}>
            Cancel
          </Button>
        </>
      );
      break;
    case "ready":
      content = (
        <>
          <h1 className="text-base font-semibold">
            {shiftProductName} {version} is ready to install.
          </h1>
          <div className="flex gap-2.5">
            <Button variant="primary" className="min-w-36" onClick={restartToUpdate}>
              Restart and Install
            </Button>
            <Button className="min-w-24" onClick={later}>
              Later
            </Button>
          </div>
        </>
      );
      break;
  }

  return (
    <main className="flex h-screen flex-col bg-surface text-primary">
      <Titlebar closeOnly onClose={later} />
      <section
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[22px] px-6 pb-6 text-center"
        aria-live="polite"
      >
        <img src={appIcon} alt="" className="h-20 w-20 drop-shadow-md" />
        {content}
      </section>
    </main>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(0, bytes / 1_000).toFixed(0)} KB`;

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
