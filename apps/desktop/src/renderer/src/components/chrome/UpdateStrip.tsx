import { useEffect, useState } from "react";
import { Button, cn } from "@shift/ui";
import { message } from "@shared/messages";
import type { ShownUpdateNotice, UpdateNotice } from "@shared/update/types";
import UpdateGhost from "@/assets/update-ghost.svg";
import { shiftProductName } from "@/app/release";
import { getShiftHost } from "@/host/shiftHost";

const HIDDEN: UpdateNotice = { type: "hidden" };

const STRIP =
  "pointer-events-auto relative flex h-10 w-85 items-center gap-3 overflow-hidden rounded-xl pl-3.5 shadow-lg";

const LABEL = "relative min-w-0 flex-1 truncate text-label font-semibold";

interface UpdateStripProps {
  /** Positions the strip in its container, which must be `relative`. */
  readonly className?: string;
}

/**
 * The one-line update prompt at the bottom of launcher and workspace windows:
 * "Update available" with Download and Later, then the download's progress
 * filling the strip, then a dark "Downloaded" strip with Restart and Later.
 * Main owns the state; every window shows the same strip.
 */
export function UpdateStrip({ className }: UpdateStripProps) {
  const notice = useUpdateNotice();
  if (notice.type === "hidden") return null;

  const label = message("update.strip.accessibleLabel", {
    applicationName: shiftProductName,
    version: notice.version,
  });

  return (
    <div
      role="status"
      aria-label={label}
      className={cn("pointer-events-none absolute flex", className)}
    >
      <UpdateStripContent notice={notice} />
    </div>
  );
}

const UpdateStripContent = ({ notice }: { notice: ShownUpdateNotice }) => {
  const host = getShiftHost();
  const run = (action: () => Promise<void>, failure: string) => async () => {
    try {
      await action();
    } catch (error) {
      console.error(failure, error);
    }
  };
  const later = run(() => host.update.later(), "putting off the update failed");

  switch (notice.type) {
    case "available":
      return (
        <div className={cn(STRIP, "bg-surface pr-2 text-primary ring-1 ring-line-subtle")}>
          <UpdateGhost aria-hidden="true" className="h-5.5 w-6.5 shrink-0" />
          <span className={LABEL}>{message("update.strip.available")}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="primary"
              size="prompt"
              onClick={run(
                () => host.update.startDownload(),
                "starting the update download failed",
              )}
            >
              {message("action.download")}
            </Button>
            <Button variant="muted" size="prompt" onClick={later}>
              {message("action.later")}
            </Button>
          </div>
        </div>
      );
    case "downloading":
      return (
        <div className={cn(STRIP, "bg-surface pr-4 text-primary ring-1 ring-line-subtle")}>
          <div
            role="progressbar"
            aria-label={message("update.strip.downloading")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(notice.percent)}
            className="absolute inset-y-0 left-0 bg-accent/12 transition-[width] duration-200"
            style={{ width: `${notice.percent}%` }}
          />
          <UpdateGhost aria-hidden="true" className="relative h-5.5 w-6.5 shrink-0" />
          <span className={LABEL}>{message("update.strip.downloading")}</span>
          <span className="relative text-sm font-medium text-secondary tabular-nums">
            {Math.floor(notice.percent)}%
          </span>
        </div>
      );
    case "ready":
      return (
        <div className={cn(STRIP, "bg-surface-inverse pr-2 text-on-surface-inverse")}>
          <UpdateGhost aria-hidden="true" className="h-5.5 w-6.5 shrink-0" />
          <span className={LABEL}>{message("update.strip.ready")}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="primary"
              size="prompt"
              onClick={run(() => host.update.restartToUpdate(), "restarting to update failed")}
            >
              {message("action.restart")}
            </Button>
            <Button variant="inverse" size="prompt" onClick={later}>
              {message("action.later")}
            </Button>
          </div>
        </div>
      );
  }
};

/** What main says the update strip shows, kept current as it changes. */
function useUpdateNotice(): UpdateNotice {
  const [notice, setNotice] = useState<UpdateNotice>(HIDDEN);

  useEffect(() => {
    const host = getShiftHost();
    let changed = false;
    const unsubscribe = host.update.onNoticeChanged((next) => {
      changed = true;
      setNotice(next);
    });
    const load = async () => {
      try {
        const current = await host.update.notice();
        // A change that arrived while asking is newer than the answer.
        if (!changed) setNotice(current);
      } catch (error) {
        console.error("reading the update notice failed", error);
      }
    };
    void load();

    return () => {
      changed = true;
      unsubscribe();
    };
  }, []);

  return notice;
}
