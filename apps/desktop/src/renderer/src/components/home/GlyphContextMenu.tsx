import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@shift/ui";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

interface GlyphContextMenuProps {
  /** The glyph under a right-click, or null over empty space, where no menu opens. */
  readonly glyphAt: (event: MouseEvent<HTMLElement>) => GlyphCatalogItem | null;
  readonly selection: GlyphSelection;
  readonly selectGlyphs: (selection: GlyphSelection) => void;
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  /** Starts renaming in place; omitted where glyphs cannot be renamed. */
  readonly renameGlyph?: (glyph: GlyphCatalogItem) => void;
  readonly children: ReactNode;
}

/**
 * The glyph grid's right-click menu: open, rename, copy name.
 *
 * @remarks
 * Right-clicking a glyph outside the selection selects it alone first, so the
 * menu and the glyph sidebar describe the same glyph; right-clicking one of
 * the selected glyphs keeps the selection. Over empty space no menu opens.
 */
export const GlyphContextMenu = ({
  glyphAt,
  selection,
  selectGlyphs,
  openGlyph,
  renameGlyph,
  children,
}: GlyphContextMenuProps) => {
  const [open, setOpen] = useState(false);
  const [glyph, setGlyph] = useState<GlyphCatalogItem | null>(null);
  // Read when the menu asks to open, which follows the right-click in the same event.
  const targetRef = useRef<GlyphCatalogItem | null>(null);
  const run = (action: (glyph: GlyphCatalogItem) => unknown) => {
    if (!glyph) return;
    void Promise.resolve(action(glyph)).catch((error: unknown) =>
      console.error("glyph context-menu action failed", error),
    );
  };

  return (
    <ContextMenu open={open} onOpenChange={(next) => setOpen(next && targetRef.current !== null)}>
      <ContextMenuTrigger
        className="contents"
        onContextMenu={(event) => {
          const target = glyphAt(event);
          targetRef.current = target;
          setGlyph(target);
          if (target && !selection.has(target.id)) {
            selectGlyphs(selection.click(target.id, { range: false, toggle: false }));
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup>
            <ContextMenuItem onClick={() => run(openGlyph)}>Open</ContextMenuItem>
            {renameGlyph ? (
              <ContextMenuItem onClick={() => run(renameGlyph)}>Rename</ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => run(async (target) => navigator.clipboard.writeText(target.name))}
            >
              Copy Name
            </ContextMenuItem>
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenu>
  );
};
