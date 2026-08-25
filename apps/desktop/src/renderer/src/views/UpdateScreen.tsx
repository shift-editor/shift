import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Button, Progress } from "@shift/ui";
import logo from "@/assets/logo@1024.png";
import { getShiftHost } from "@/host/shiftHost";
import type { UpdateProgress } from "@shared/update/types";
import "./UpdateScreen.css";

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
          <div className="update-window-copy">
            <h1>Shift {version} is available.</h1>
            <p>Would you like to download it now?</p>
          </div>
          <div className="update-window-actions">
            <Button
              variant="primary"
              size="lg"
              className="update-window-primary-button"
              onClick={startDownload}
            >
              Download Update
            </Button>
            <Button size="lg" className="update-window-button" onClick={later}>
              Later
            </Button>
          </div>
        </>
      );
      break;
    case "downloading":
      content = (
        <>
          <div className="update-window-copy">
            <h1>{progressText}</h1>
          </div>
          <Progress
            aria-label="Update download progress"
            aria-valuetext={progressText}
            value={progress.percent}
            className="update-window-progress"
            trackClassName="update-window-progress-track"
            indicatorClassName="update-window-progress-indicator"
          />
          <Button size="lg" className="update-window-button" onClick={cancelDownload}>
            Cancel
          </Button>
        </>
      );
      break;
    case "ready":
      content = (
        <>
          <div className="update-window-copy">
            <h1>Shift {version} is ready to install.</h1>
          </div>
          <div className="update-window-actions">
            <Button
              variant="primary"
              size="lg"
              className="update-window-primary-button"
              onClick={restartToUpdate}
            >
              Restart and Install
            </Button>
            <Button size="lg" className="update-window-button" onClick={later}>
              Later
            </Button>
          </div>
        </>
      );
      break;
  }

  return (
    <main className="update-window">
      <section className="update-window-content" aria-live="polite">
        <img src={logo} alt="" className="update-window-icon" />
        {content}
      </section>
    </main>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(0, bytes / 1_000).toFixed(0)} KB`;

  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
