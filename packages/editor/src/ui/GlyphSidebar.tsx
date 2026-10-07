import { Button, Separator, cn } from "@shift/ui";
import type { ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { formatCodepointAsUPlus } from "../lib/utils/unicode";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { ShiftIcon } from "./ShiftIcon";
import type { EditorUISession } from "./types";
import { useGlyphMetrics } from "./useGlyphMetrics";

/** Application content merged into the glyph sidebar. */
export interface GlyphSidebarHost {
  /** Replaces the default header of family name and zoom control. */
  header?: ReactNode;
  /** Label shown under the metrics; defaults to the glyph name. */
  glyphLabel?: string;
  /** Rendered below the glyph metrics, for panels about the current selection. */
  selection?: ReactNode;
}

export interface GlyphSidebarProps {
  session: EditorUISession;
  host?: GlyphSidebarHost;
}

/**
 * Renders the glyph inspector: codepoint, sidebearings, advance, and name.
 *
 * @remarks
 * Shows the glyph metrics section the inspector returns for the current
 * subject, and sends edits to its target. A metric the glyphs
 * disagree on shows empty, and an edit applies to every glyph.
 */
export function GlyphSidebar({ session, host = {} }: GlyphSidebarProps) {
  const { editor, font } = session;
  const metadata = useSignalState(font.metadataCell);
  const zoom = useSignalState(editor.zoomCell);
  const { target, values } = useGlyphMetrics(editor);
  const glyphs = target?.glyphs ?? [];
  const glyph = glyphs.length === 1 ? (glyphs[0] ?? null) : null;

  const { editable, sidebearingsEditable } = values;
  const leftSidebearing = values.lsb === null ? null : Math.round(values.lsb);
  const rightSidebearing = values.rsb === null ? null : Math.round(values.rsb);
  const unicode = glyph?.unicode ?? null;
  const glyphLabel = glyphLabelFor(glyphs, host.glyphLabel);

  return (
    <aside
      aria-label="Glyph properties"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-line-subtle bg-surface"
    >
      <div className="flex items-center justify-between px-3 py-2">
        {host.header ?? (
          <>
            <span className="truncate text-ui font-medium text-primary">
              {metadata.familyName ?? "Untitled"}
            </span>
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
          </>
        )}
      </div>
      <Separator />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 py-3">
          <section className="flex flex-col gap-2">
            <h3 className="text-ui font-medium text-primary">Glyph</h3>
            <main className="flex flex-col items-center">
              <div className="mb-2 flex flex-col items-center gap-0.5">
                <div className={cn("font-mono text-sm", unicode === null && "text-secondary")}>
                  {unicode === null ? "—" : formatCodepointAsUPlus(unicode)}
                </div>
              </div>
              <div className="flex items-center justify-center gap-2">
                <EditableSidebarInput
                  ariaLabel="Left sidebearing"
                  label="LSB"
                  className="text-right"
                  value={leftSidebearing}
                  disabled={!sidebearingsEditable}
                  onValueChange={
                    sidebearingsEditable ? (value) => target?.set("left", value) : undefined
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
                    sidebearingsEditable ? (value) => target?.set("right", value) : undefined
                  }
                />
              </div>
              <div className="mt-2">
                <EditableSidebarInput
                  ariaLabel="Advance width"
                  className="text-center"
                  value={values.xAdvance === null ? null : Math.round(values.xAdvance)}
                  disabled={!editable}
                  onValueChange={editable ? (value) => target?.set("advance", value) : undefined}
                />
              </div>
              <div
                className={cn("mt-2 font-sans text-sm", glyphLabel === null && "text-secondary")}
              >
                {glyphLabel ?? "—"}
              </div>
            </main>
          </section>
        </div>
        <Separator />
        {host.selection}
      </div>
    </aside>
  );
}

/** Names one glyph, counts several, and shows nothing for none. */
function glyphLabelFor(glyphs: readonly { name: string }[], hostLabel?: string): string | null {
  const [only] = glyphs;
  if (glyphs.length === 0 || !only) return null;
  if (glyphs.length > 1) return `${glyphs.length} glyphs`;

  return hostLabel ?? only.name;
}
