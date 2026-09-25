import { useCallback, useMemo, useRef, useState } from "react";
import {
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
import { SvgGlyphCatalogGrid } from "@/components/home/SvgGlyphCatalogGrid";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { useEditor, useFont } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { componentPickerGlyphs } from "./componentPicker";

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
  const addingComponentRef = useRef(false);
  const glyphNodes = editor.scene.nodesOfKind("glyph");
  const currentGlyphId = glyphNodes.length === 1 ? (glyphNodes[0]?.glyphId ?? null) : null;
  const glyphs = useMemo(
    () =>
      currentGlyphId
        ? componentPickerGlyphs(
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
    onOpenChange(false);
  }, [onOpenChange]);

  const addComponent = useCallback(
    async (glyph: GlyphCatalogItem) => {
      if (addingComponentRef.current) return;

      addingComponentRef.current = true;
      try {
        const componentId = await editor.addComponent(glyph.id);
        if (componentId) close();
      } catch (error) {
        console.error("failed to add component", error);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          className={cn(
            "fixed left-1/2 top-1/2 flex h-150 w-200 max-w-full flex-col",
            "-translate-x-1/2 -translate-y-1/2 overflow-hidden",
            "border border-line-subtle bg-surface-muted",
          )}
        >
          <header className="flex items-center gap-3 border-b border-line-subtle px-4 py-3">
            <DialogTitle className="shrink-0">Add Component</DialogTitle>
            <form
              className="min-w-0 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                const normalizedQuery = componentQuery.trim().toLowerCase();
                const exactGlyph = glyphs.find(
                  (glyph) =>
                    glyph.name.toLowerCase() === normalizedQuery ||
                    glyph.displayName.toLowerCase() === normalizedQuery,
                );
                const glyph = exactGlyph ?? glyphs[0];
                if (glyph) void addComponent(glyph);
              }}
            >
              <Input
                autoFocus
                aria-label="Search components"
                icon={<Search className="h-3.5 w-3.5 text-muted" />}
                iconPosition="left"
                placeholder="Search by glyph name, character, or Unicode"
                size="md"
                value={componentQuery}
                onChange={(event) => setComponentQuery(event.currentTarget.value)}
              />
            </form>
            <Tooltip>
              <TooltipTrigger>
                <DialogClose variant="icon" aria-label="Close component picker">
                  <X className="h-4 w-4" />
                </DialogClose>
              </TooltipTrigger>
              <TooltipContent>Close</TooltipContent>
            </Tooltip>
          </header>

          <div className="relative min-h-0 flex-1 bg-background">
            {glyphs.length > 0 ? (
              <SvgGlyphCatalogGrid
                glyphs={glyphs}
                location={catalog.location}
                metrics={catalog.metrics}
                active={open}
                observeAtlasInvalidation={catalog.observeAtlasInvalidation}
                glyphPreviews={catalog.glyphPreviews}
                canAuthor={false}
                openGlyph={addComponent}
                glyphActionLabel={(glyph) => `Add ${glyph.displayName} as a component`}
                onPendingGlyphName={() => {}}
                onFirstFrame={() => {}}
                onUnavailable={() => {}}
              />
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-muted">
                No matching glyphs
              </p>
            )}
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
