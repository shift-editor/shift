import { Button, ScrollArea, Separator } from "@shift/ui";
import { useMemo, type ReactNode } from "react";
import { computed, useSignalState } from "../lib/signals";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { GlyphIdentityFields } from "./GlyphIdentityFields";
import { ShiftIcon } from "./ShiftIcon";
import type { EditorUISession } from "./types";
import { useGlyphMetrics } from "./useGlyphMetrics";

/** Application content merged into the glyph sidebar. */
export interface GlyphSidebarHost {
  /** Controls at the end of the header, after the glyph's name; replaces the default zoom control. */
  headerActions?: ReactNode;
  /** Rendered below the glyph metrics, for panels about the current selection. */
  selection?: ReactNode;
}

export interface GlyphSidebarProps {
  session: EditorUISession;
  host?: GlyphSidebarHost;
}

/**
 * Renders the glyph inspector: the page name, then the glyph's sidebearings, advance, name, and codepoint.
 *
 * @remarks
 * Metrics are live for the single glyph placed in the scene and empty when
 * there are none or several. They are editable only when the session can edit
 * layers and the glyph has a layer at the active source or location.
 */
export function GlyphSidebar({ session, host = {} }: GlyphSidebarProps) {
  const { editor } = session;
  const zoom = useSignalState(editor.zoomCell);
  const { glyph, sidebearings, xAdvance, hasLayer } = useGlyphMetrics(editor);

  // Metric edits go through workspace layer intents, which memory sessions lack.
  const editable = session.mode !== "memory" && hasLayer;
  const leftSidebearing = sidebearings.lsb === null ? null : Math.round(sidebearings.lsb);
  const rightSidebearing = sidebearings.rsb === null ? null : Math.round(sidebearings.rsb);
  const sidebearingsEditable = editable && leftSidebearing !== null && rightSidebearing !== null;
  const pageNameCell = useMemo(
    () => computed(() => editor.scene.shownPage()?.name ?? null),
    [editor],
  );
  const pageName = useSignalState(pageNameCell);

  return (
    <aside
      aria-label="Glyph properties"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-line-subtle bg-surface"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-ui font-medium text-primary">
          {pageName ?? "Untitled"}
        </span>
        {host.headerActions ?? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Fit glyph to view, ${Math.round(zoom * 100)}%`}
            className="h-5 shrink-0 gap-1 px-1 text-ui font-medium text-primary"
            onClick={() => editor.zoomToFit()}
          >
            {Math.round(zoom * 100)}%
            <ShiftIcon name="chevron-right" className="h-3 w-3 rotate-90" />
          </Button>
        )}
      </div>
      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 py-3">
          <section className="flex flex-col gap-2">
            <h3 className="text-ui font-medium text-primary">Glyph</h3>
            <main className="flex flex-col items-center">
              <div className="flex items-center justify-center gap-2">
                <EditableSidebarInput
                  ariaLabel="Left sidebearing"
                  label="LSB"
                  className="text-right"
                  value={leftSidebearing}
                  disabled={!sidebearingsEditable}
                  onValueChange={
                    sidebearingsEditable ? (value) => editor.setLeftSidebearing(value) : undefined
                  }
                />
                <div className="px-2">
                  <ShiftIcon name="placeholder-glyph" className="h-[55px] w-8 text-primary" />
                </div>
                <EditableSidebarInput
                  ariaLabel="Right sidebearing"
                  label="RSB"
                  labelPosition="right"
                  className="text-left"
                  value={rightSidebearing}
                  disabled={!sidebearingsEditable}
                  onValueChange={
                    sidebearingsEditable ? (value) => editor.setRightSidebearing(value) : undefined
                  }
                />
              </div>
              <div className="mt-2">
                <EditableSidebarInput
                  ariaLabel="Advance width"
                  className="text-center"
                  value={glyph ? Math.round(xAdvance) : null}
                  disabled={!editable}
                  onValueChange={editable ? (value) => editor.setXAdvance(value) : undefined}
                />
              </div>
              <div className="mt-3 w-full">
                <GlyphIdentityFields
                  font={session.font}
                  glyph={glyph}
                  // Identity edits go through workspace intents; previews are read-only.
                  editable={session.mode === "workspace"}
                />
              </div>
            </main>
          </section>
        </div>
        <Separator />
        {host.selection}
      </ScrollArea>
    </aside>
  );
}
