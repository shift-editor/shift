import { useCallback, useMemo, useRef, useState } from "react";
import {
  Button,
  cn,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  Search,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
} from "@shift/ui";
import { useSignalState } from "@shift/editor/signals";
import AddIcon from "@/assets/general/add.svg";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import type { ComponentCandidate } from "@/types/componentPicker";
import { useEditor, useFont } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { componentPickerCandidates } from "./componentPicker";

interface ComponentPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ComponentPickerDialog({ open, onOpenChange }: ComponentPickerDialogProps) {
  const editor = useEditor();
  const font = useFont();

  const catalog = useGlyphCatalog();
  const glyphInfo = getGlyphInfo();
  const records = useSignalState(font.glyphRecordsCell);

  const [componentQuery, setComponentQuery] = useState("");
  const [pendingCreation, setPendingCreation] = useState<ComponentCandidate | null>(null);

  const addingComponentRef = useRef(false);
  const glyphNodes = editor.scene.nodesOfKind("glyph");
  const currentGlyphId = glyphNodes.length === 1 ? (glyphNodes[0]?.glyphId ?? null) : null;
  const candidates = useMemo(
    () =>
      currentGlyphId
        ? componentPickerCandidates(
            catalog.availableGlyphs,
            records,
            currentGlyphId,
            componentQuery,
            glyphInfo,
          )
        : [],
    [catalog.availableGlyphs, componentQuery, currentGlyphId, glyphInfo, records],
  );

  const close = useCallback(() => {
    setComponentQuery("");
    setPendingCreation(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const addComponent = useCallback(
    async (candidate: ComponentCandidate) => {
      if (candidate.availability !== "existing" || addingComponentRef.current) return;

      addingComponentRef.current = true;
      try {
        const componentId = await editor.addComponent(candidate.glyphId);
        if (componentId) close();
      } catch (error) {
        console.error("failed to add component", error);
      } finally {
        addingComponentRef.current = false;
      }
    },
    [close, editor],
  );

  const createGlyphAndAddComponent = useCallback(
    async (candidate: ComponentCandidate) => {
      if (candidate.availability !== "missing" || addingComponentRef.current) return;

      addingComponentRef.current = true;
      try {
        const componentId = await editor.createGlyphAndAddComponent(candidate.name);
        if (componentId) close();
      } catch (error) {
        console.error("failed to create glyph component", error);
      } finally {
        addingComponentRef.current = false;
      }
    },
    [close, editor],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      close();
    },
    [close, onOpenChange],
  );

  if (!font.loaded || !currentGlyphId) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="fixed left-1/2 top-1/2 flex h-100 w-87.5 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-line-subtle">
            <header className="flex h-10 shrink-0 items-center justify-between border-b border-line-subtle px-3">
              <DialogTitle>Add Component</DialogTitle>
              <Tooltip>
                <TooltipTrigger>
                  <DialogClose variant="icon" aria-label="Close Add Component">
                    <X className="h-4 w-4" />
                  </DialogClose>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </header>
            <form
              className="shrink-0 border-b border-line-subtle p-2"
              onSubmit={(event) => {
                event.preventDefault();
                const normalizedQuery = componentQuery.trim().toLowerCase();
                const exactCandidate = candidates.find(
                  (candidate) =>
                    candidate.name.toLowerCase() === normalizedQuery ||
                    candidate.displayName.toLowerCase() === normalizedQuery,
                );
                const candidate = exactCandidate ?? candidates[0];
                if (!candidate) return;

                if (candidate.availability === "missing") {
                  setPendingCreation(candidate);
                  return;
                }

                void addComponent(candidate);
              }}
            >
              <Input
                autoFocus
                aria-label="Search components"
                icon={<Search className="h-3 w-3 text-muted" />}
                iconPosition="left"
                placeholder="Search"
                size="md"
                value={componentQuery}
                onChange={(event) => setComponentQuery(event.currentTarget.value)}
              />
            </form>

            <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
              {candidates.length > 0 ? (
                candidates.slice(0, 100).map((candidate) => (
                  <Button
                    key={`${candidate.availability}-${candidate.glyphId ?? candidate.unicode}`}
                    type="button"
                    aria-label={
                      candidate.availability === "missing"
                        ? `Create and add ${candidate.displayName} as a component`
                        : `Add ${candidate.displayName} as a component`
                    }
                    variant="row"
                    className="h-14 text-left"
                    onClick={async () => {
                      if (candidate.availability === "missing") {
                        setPendingCreation(candidate);
                        return;
                      }

                      await addComponent(candidate);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "relative flex h-10 w-10 shrink-0 items-center justify-center",
                        "font-display text-3xl font-normal leading-none",
                        candidate.availability === "missing" ? "text-secondary" : "text-primary",
                      )}
                    >
                      {candidate.unicode === null ? "—" : String.fromCodePoint(candidate.unicode)}
                      {candidate.availability === "missing" && (
                        <AddIcon className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 text-muted" />
                      )}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-sm font-semibold text-primary">
                        {candidate.displayName}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-xs font-normal text-muted">
                        {candidate.unicode === null
                          ? "Unencoded"
                          : `U+${candidate.unicode.toString(16).toUpperCase().padStart(4, "0")}`}
                      </span>
                    </span>
                  </Button>
                ))
              ) : (
                <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
                  No matching glyphs
                </p>
              )}
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      <Dialog
        open={pendingCreation?.availability === "missing"}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingCreation(null);
        }}
      >
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="fixed left-1/2 top-1/2 w-80 -translate-x-1/2 -translate-y-1/2 border border-line-subtle p-4">
            <DialogTitle className="text-base font-medium text-primary">
              Create {pendingCreation?.displayName}?
            </DialogTitle>
            <p className="mt-2 text-sm text-muted">
              Create the empty glyph and add it as a component.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="default" size="sm" onClick={() => setPendingCreation(null)}>
                Cancel
              </Button>
              <Button
                autoFocus
                variant="primary"
                size="sm"
                onClick={async () => {
                  if (pendingCreation) await createGlyphAndAddComponent(pendingCreation);
                }}
              >
                Create
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </>
  );
}
