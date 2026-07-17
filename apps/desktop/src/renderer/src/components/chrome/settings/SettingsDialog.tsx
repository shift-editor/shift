import type { ReactNode } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  X,
  cn,
} from "@shift/ui";
import type { SettingsCategory, SettingsTarget } from "@/types/settings";
import { useFont } from "@/workspace/WorkspaceContext";
import { AxesSettingsPanel } from "./AxesSettingsPanel";
import { FontSettingsPanel } from "./FontSettingsPanel";
import { InstancesSettingsPanel } from "./InstancesSettingsPanel";
import { SettingsSidebar } from "./SettingsSidebar";
import { SourcesSettingsPanel } from "./SourcesSettingsPanel";

interface SettingsDialogProps {
  target: SettingsTarget | null;
  onTargetChange: (target: SettingsTarget) => void;
  onOpenChange: (open: boolean) => void;
}

export const SettingsDialog = ({ target, onTargetChange, onOpenChange }: SettingsDialogProps) => {
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
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <SettingsSidebar
            category={activeTarget.category}
            onCategoryChange={(category) => {
              onTargetChange(targetForCategory(category));
            }}
          />

          <main className="relative min-h-0 min-w-0 overflow-hidden bg-canvas">
            <DialogClose
              className={cn(
                "absolute right-2 top-2 z-10 inline-flex h-7 w-7 cursor-pointer",
                "items-center justify-center rounded text-primary/70 transition-colors",
                "hover:bg-hover hover:text-primary",
              )}
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </DialogClose>

            <SettingsCategoryPanel target={activeTarget} />
          </main>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};

interface SettingsCategoryPanelProps {
  target: SettingsTarget;
}

const SettingsCategoryPanel = ({ target }: SettingsCategoryPanelProps) => {
  switch (target.category) {
    case "font":
      return (
        <ScrollablePanel>
          <FontSettingsPanel />
        </ScrollablePanel>
      );
    case "sources":
      return (
        <SourcesSettingsPanel
          key={target.sourceId ?? "sources"}
          initialSourceId={target.sourceId}
        />
      );
    case "instances":
      return (
        <InstancesSettingsPanel
          key={target.instanceId ?? "instances"}
          initialInstanceId={target.instanceId}
        />
      );
    case "axes":
      return <AxesSettingsPanel key={target.axisId ?? "axes"} initialAxisId={target.axisId} />;
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
