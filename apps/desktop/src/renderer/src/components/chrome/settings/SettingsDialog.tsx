import type { ReactNode } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
  cn,
} from "@shift/ui";
import { message } from "@shared/messages";
import type { SettingsCategory, SettingsTarget } from "@/types/settings";
import { useFont } from "@/workspace/WorkspaceContext";
import { AxesSettingsPanel } from "./AxesSettingsPanel";
import { FontSettingsPanel } from "./FontSettingsPanel";
import { InstancesSettingsPanel } from "./InstancesSettingsPanel";
import { SettingsSidebar } from "./SettingsSidebar";
import { SourcesSettingsPanel } from "./SourcesSettingsPanel";

interface SettingsDialogProps {
  target: SettingsTarget | null;
  canAuthor: boolean;
  onTargetChange: (target: SettingsTarget) => void;
  onOpenChange: (open: boolean) => void;
}

export const SettingsDialog = ({
  target,
  canAuthor,
  onTargetChange,
  onOpenChange,
}: SettingsDialogProps) => {
  const font = useFont();
  const activeTarget: SettingsTarget = target ?? { category: "font" };

  if (!font.loaded) return null;

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed left-1/2 top-1/2 h-[500px]",
            "w-[800px] max-w-none -translate-x-1/2 -translate-y-1/2",
            "grid grid-cols-[9.5rem_minmax(0,1fr)] overflow-hidden rounded-lg",
            "border border-line-subtle bg-canvas shadow-lg",
          )}
        >
          <DialogTitle className="sr-only">{message("settings.dialog.title")}</DialogTitle>
          <SettingsSidebar
            category={activeTarget.category}
            onCategoryChange={(category) => {
              onTargetChange(targetForCategory(category));
            }}
          />

          <main
            aria-label="Settings details"
            className="relative min-h-0 min-w-0 overflow-hidden bg-canvas"
          >
            <Tooltip>
              <TooltipTrigger>
                <DialogClose
                  className={cn(
                    "absolute right-2 top-2 z-10 inline-flex h-7 w-7 cursor-pointer",
                    "items-center justify-center rounded text-primary/70 transition-colors",
                    "hover:bg-hover hover:text-primary",
                  )}
                  aria-label={message("settings.dialog.close")}
                >
                  <X className="h-4 w-4" />
                </DialogClose>
              </TooltipTrigger>
              <TooltipContent>{message("settings.dialog.close")}</TooltipContent>
            </Tooltip>

            <SettingsCategoryPanel target={activeTarget} canAuthor={canAuthor} />
          </main>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};

interface SettingsCategoryPanelProps {
  target: SettingsTarget;
  canAuthor: boolean;
}

const SettingsCategoryPanel = ({ target, canAuthor }: SettingsCategoryPanelProps) => {
  switch (target.category) {
    case "font":
      return (
        <ScrollablePanel>
          <FontSettingsPanel canAuthor={canAuthor} />
        </ScrollablePanel>
      );
    case "sources":
      return (
        <SourcesSettingsPanel
          key={target.sourceId ?? "sources"}
          initialSourceId={target.sourceId}
          canAuthor={canAuthor}
        />
      );
    case "instances":
      return (
        <InstancesSettingsPanel
          key={target.instanceId ?? "instances"}
          initialInstanceId={target.instanceId}
          canAuthor={canAuthor}
        />
      );
    case "axes":
      return (
        <AxesSettingsPanel
          key={target.axisId ?? "axes"}
          initialAxisId={target.axisId}
          canAuthor={canAuthor}
        />
      );
  }
};

function targetForCategory(category: SettingsCategory): SettingsTarget {
  switch (category) {
    case "font":
      return { category: "font" };
    case "sources":
      return { category: "sources" };
    case "instances":
      return { category: "instances" };
    case "axes":
      return { category: "axes" };
  }
}

const ScrollablePanel = ({ children }: { children: ReactNode }) => (
  <div className="scrollbar-hidden h-full overflow-y-auto">{children}</div>
);
