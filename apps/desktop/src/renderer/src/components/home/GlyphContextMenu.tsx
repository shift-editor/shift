import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { GlyphId } from "@shift/types";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@shift/ui";
import { MarkColorPicker } from "../glyph-grid/MarkColorPicker";
import { SetSidebearingsDialog } from "./SetSidebearingsDialog";
import { useWindowTabs } from "@/hooks/useWindowTabs";
import { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import { GridActions } from "@/lib/glyph-grid/gridActions";
import { markColorKey } from "@/lib/glyph-grid/markColor";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { useFontSession } from "@/workspace/WorkspaceContext";

interface GlyphContextMenuProps {
  /** The glyph under a right-click, or null over empty space, where no menu opens. */
  readonly glyphAt: (event: MouseEvent<HTMLElement>) => GlyphCatalogItem | null;
  /** The glyphs shown, in grid order. */
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly selection: GlyphSelection;
  readonly selectGlyphs: (selection: GlyphSelection) => void;
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  /** Starts renaming in place; omitted where glyphs cannot be edited, which hides every edit. */
  readonly renameGlyph?: (glyph: GlyphCatalogItem) => void;
  readonly children: ReactNode;
}

/**
 * The glyph grid's right-click menu, which acts on the selection: open,
 * rename, copy names, tag with a colour, duplicate, decompose, and set
 * sidebearings.
 *
 * @remarks
 * Right-clicking a glyph outside the selection selects it alone first, so the
 * menu and the glyph sidebar describe the same glyph; right-clicking one of
 * the selected glyphs keeps the selection. Over empty space no menu opens.
 * Every edit is one undo step, however many glyphs it changes.
 */
export const GlyphContextMenu = ({
  glyphAt,
  glyphs,
  selection,
  selectGlyphs,
  openGlyph,
  renameGlyph,
  children,
}: GlyphContextMenuProps) => {
  const { editor } = useFontSession();
  const { showPage } = useWindowTabs();
  const actions = useMemo(() => new GridActions(editor), [editor]);
  const [open, setOpen] = useState(false);
  const [glyph, setGlyph] = useState<GlyphCatalogItem | null>(null);
  const [sidebearingGlyphIds, setSidebearingGlyphIds] = useState<readonly GlyphId[]>([]);
  // Read when the menu asks to open, which follows the right-click in the same event.
  const targetRef = useRef<GlyphCatalogItem | null>(null);

  // The menu acts on the selection when the right-clicked glyph is in it, else on that glyph.
  const selected = glyphs.filter((candidate) => selection.has(candidate.id));
  const clickedInSelection = glyph !== null && selection.has(glyph.id);
  const targets = clickedInSelection || !glyph ? selected : [glyph];
  const [single] = targets.length === 1 ? targets : [];
  const glyphIds = targets.map((target) => target.id);
  const canEdit = renameGlyph !== undefined;
  const colors = new Map(
    targets.map((target) => [markColorKey(target.markColor), target.markColor]),
  );

  const run = (action: () => unknown) => {
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => console.error("glyph context-menu action failed", error));
  };
  const openTargets = async () => {
    if (single) {
      await openGlyph(single);
      return;
    }

    await editor.font.loadGlyphs(glyphIds);
    const page = actions.openAsText(glyphIds);
    if (page) showPage(page.id, { newTab: true });
  };
  const duplicate = async () => {
    const copyIds = await actions.duplicate(glyphIds);
    selectGlyphs(GlyphSelection.empty(copyIds).all());
  };

  return (
    <>
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
              <ContextMenuItem onClick={() => run(openTargets)}>Open</ContextMenuItem>
              {single && renameGlyph ? (
                <ContextMenuItem onClick={() => renameGlyph(single)}>Rename</ContextMenuItem>
              ) : null}
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() =>
                  run(async () =>
                    navigator.clipboard.writeText(targets.map((target) => target.name).join(" ")),
                  )
                }
              >
                {single ? "Copy Name" : "Copy Names"}
              </ContextMenuItem>
              {canEdit ? (
                <>
                  <ContextMenuSeparator />
                  <div className="px-2 py-1">
                    <MarkColorPicker
                      current={colors}
                      onPick={(color) => {
                        actions.tag(glyphIds, color);
                        setOpen(false);
                      }}
                    />
                  </div>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => run(duplicate)}>Duplicate</ContextMenuItem>
                  <ContextMenuItem
                    disabled={!actions.canDecompose(glyphIds)}
                    onClick={() => actions.decompose(glyphIds)}
                  >
                    Decompose Components
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setSidebearingGlyphIds(glyphIds)}>
                    Set Sidebearings…
                  </ContextMenuItem>
                </>
              ) : null}
            </ContextMenuPopup>
          </ContextMenuPositioner>
        </ContextMenuPortal>
      </ContextMenu>
      <SetSidebearingsDialog
        glyphIds={sidebearingGlyphIds}
        actions={actions}
        keyProblem={(key) => editor.font.metricsKeyProblem(key)}
        onClose={() => setSidebearingGlyphIds([])}
      />
    </>
  );
};
