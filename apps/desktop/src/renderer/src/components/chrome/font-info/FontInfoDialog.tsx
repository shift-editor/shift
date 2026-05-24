import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  X,
  cn,
} from "@shift/ui";
import { getEditor } from "@/store/store";
import { FontMetadataPanel } from "./FontMetadataPanel";
import { FontSourcesPanel } from "./FontSourcesPanel";

interface FontInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SectionId = "font" | "sources";

const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: "font", label: "Font information" },
  { id: "sources", label: "Sources" },
];

export const FontInfoDialog = ({ open, onOpenChange }: FontInfoDialogProps) => {
  const editor = getEditor();
  const [section, setSection] = useState<SectionId>("font");
  const title = SECTIONS.find((item) => item.id === section)?.label ?? "Font information";

  if (!editor.font.loaded) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed inset-8 left-8 top-8 max-w-none translate-x-0 translate-y-0 max-w-[1200px] max-h-[800px] m-auto",
            "grid grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-lg border border-line-subtle",
            "shadow-lg",
          )}
        >
          <nav className="flex flex-col gap-1 items-start bg-white p-2">
            {SECTIONS.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                isActive={section === item.id}
                className="w-full justify-start p-0 pl-2 font-medium text-primary"
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </nav>

          <section className="relative bg-canvas p-6 overflow-auto">
            <DialogClose
              className={cn(
                "absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center cursor-pointer",
                "rounded text-primary/70 hover:text-primary hover:bg-hover transition-colors",
              )}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogClose>

            <DialogTitle className="mb-6 text-sm font-medium text-primary">{title}</DialogTitle>
            {section === "font" ? <FontMetadataPanel /> : <FontSourcesPanel />}
          </section>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
};
