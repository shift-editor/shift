import { useState, type ReactNode } from "react";
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
import { CreateAxisDialog } from "@/components/variation/CreateAxisDialog";
import { CreateSourceDialog } from "@/components/variation/CreateSourceDialog";
import { useFont } from "@/workspace/WorkspaceContext";
import { AxesSettingsPanel } from "./AxesSettingsPanel";
import { FontSettingsPanel } from "./FontSettingsPanel";
import { SettingsPlaceholder } from "./SettingsPlaceholder";
import { SettingsSidebar } from "./SettingsSidebar";
import { SourcesSettingsPanel } from "./SourcesSettingsPanel";
import type { SettingsCategory } from "./types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SettingsDialog = ({ open, onOpenChange }: SettingsDialogProps) => {
  const font = useFont();
  const [category, setCategory] = useState<SettingsCategory>("font");
  const [createAxisOpen, setCreateAxisOpen] = useState(false);
  const [createSourceOpen, setCreateSourceOpen] = useState(false);

  if (!font.loaded) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup
            className={cn(
              "fixed left-1/2 top-1/2 h-[min(640px,calc(100vh-64px))]",
              "w-[min(960px,calc(100vw-64px))] max-w-none -translate-x-1/2 -translate-y-1/2",
              "grid grid-cols-[9.5rem_minmax(0,1fr)] overflow-hidden rounded-lg",
              "border border-line-subtle bg-canvas shadow-lg",
            )}
          >
            <DialogTitle className="sr-only">Settings</DialogTitle>
            <SettingsSidebar category={category} onCategoryChange={setCategory} />

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

              <SettingsCategoryPanel
                category={category}
                onCreateAxis={() => setCreateAxisOpen(true)}
                onCreateSource={() => setCreateSourceOpen(true)}
              />
            </main>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      <CreateAxisDialog open={createAxisOpen} onOpenChange={setCreateAxisOpen} />
      <CreateSourceDialog open={createSourceOpen} onOpenChange={setCreateSourceOpen} />
    </>
  );
};

interface SettingsCategoryPanelProps {
  category: SettingsCategory;
  onCreateAxis: () => void;
  onCreateSource: () => void;
}

const SettingsCategoryPanel = ({
  category,
  onCreateAxis,
  onCreateSource,
}: SettingsCategoryPanelProps) => {
  switch (category) {
    case "font":
      return (
        <ScrollablePanel>
          <FontSettingsPanel />
        </ScrollablePanel>
      );
    case "sources":
      return <SourcesSettingsPanel onCreateSource={onCreateSource} />;
    case "axes":
      return <AxesSettingsPanel onCreateAxis={onCreateAxis} />;
    case "features":
      return (
        <ScrollablePanel>
          <SettingsPlaceholder
            title="Features"
            description="OpenType feature authoring will use this settings surface once the feature model is editable."
          />
        </ScrollablePanel>
      );
  }
};

const ScrollablePanel = ({ children }: { children: ReactNode }) => (
  <div className="h-full overflow-y-auto">{children}</div>
);
