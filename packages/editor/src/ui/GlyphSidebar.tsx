import { Button, ScrollArea, Separator, Tooltip } from "@shift/ui";
import type { MetricsKeySide } from "@shift/types";
import type { SideLink } from "@shift/wasm/protocol";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { linkOn, type MetricsLinks } from "../lib/model/MetricsLinks";
import { useSignalState } from "../lib/signals";
import { EditableSidebarInput, type EditableSidebarInputProps } from "./EditableSidebarInput";
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

/** What a metric field needs to show and edit the key its side follows. */
type MetricKeyProps = Pick<
  EditableSidebarInputProps,
  "keyText" | "onKeyCommit" | "icon" | "iconPosition"
>;

const OPPOSITE_SIDE_NAME: Record<MetricsKeySide, string> = {
  left: "RSB",
  right: "LSB",
  width: "LSB",
};

/** Characters the chip shows before it truncates; past this the tooltip names the source too. */
const CHIP_FITS = 9;

/** The chip's tooltip: the value, and the full source when the chip cuts it short. */
function chipTooltip(source: string, value: number | null): string {
  const shown = value === null ? "—" : String(value);
  return source.length > CHIP_FITS ? `${source} = ${shown}` : shown;
}

/** The key as the chip shows it: no `=` or `==`, `|` spelled out, spaces around operators. */
function keySource(key: string, side: MetricsKeySide): string {
  const body = key.replace(/^==?/, "").trim();
  if (body === "|") return OPPOSITE_SIDE_NAME[side];
  return body.replace(/\s*([+*/])\s*/g, " $1 ").replace(/\s*-\s*(?=\d)/g, " - ");
}

/**
 * The key props for the field of `side`: typing `=…` links it, blank text
 * unlinks it, and a linked field shows its key as a chip whose tooltip gives
 * the value, or why the key cannot be applied.
 */
function metricKeyProps(
  links: MetricsLinks | null,
  side: MetricsKeySide,
  link: SideLink | null,
  editable: boolean,
  value: number | null,
): MetricKeyProps {
  const onKeyCommit = editable && links ? (text: string) => links.link(side, text) : undefined;
  if (!link) return { onKeyCommit };

  const problem = link.problem ?? null;
  const chipTone =
    problem === null
      ? "bg-background text-primary ring-black/15 hover:bg-input hover:ring-black/30"
      : "bg-destructive-hover text-error ring-error-ring hover:ring-error";
  const source = keySource(link.key, side);
  const focusField = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest("div")?.querySelector("input")?.focus();
  };
  return {
    keyText: link.key,
    onKeyCommit,
    iconPosition: side === "right" ? "left" : "right",
    icon: (
      <Tooltip content={problem ?? chipTooltip(source, value)}>
        <button
          type="button"
          tabIndex={-1}
          onClick={focusField}
          className={`pointer-events-auto flex h-[18px] max-w-[4.5rem] cursor-pointer items-center rounded-[4px] px-1.5 text-ui ring-1 ring-inset transition-colors ${chipTone}`}
        >
          <span className="truncate">{source}</span>
        </button>
      </Tooltip>
    ),
  };
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
  const { glyph, sidebearings, xAdvance, hasLayer, linkedSides, links } = useGlyphMetrics(editor);

  // Metric edits go through workspace layer intents, which memory sessions lack.
  const editable = session.mode !== "memory" && hasLayer;
  const leftSidebearing = sidebearings.lsb === null ? null : Math.round(sidebearings.lsb);
  const rightSidebearing = sidebearings.rsb === null ? null : Math.round(sidebearings.rsb);
  const sidebearingsEditable = editable && leftSidebearing !== null && rightSidebearing !== null;
  const pageName = useSignalState(editor.scene.shownPageCell)?.name ?? null;

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
                  {...metricKeyProps(
                    links,
                    "left",
                    linkOn(linkedSides, "left"),
                    sidebearingsEditable,
                    leftSidebearing,
                  )}
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
                  {...metricKeyProps(
                    links,
                    "right",
                    linkOn(linkedSides, "right"),
                    sidebearingsEditable,
                    rightSidebearing,
                  )}
                />
              </div>
              <div className="mt-2">
                <EditableSidebarInput
                  ariaLabel="Advance width"
                  className="text-center"
                  value={glyph ? Math.round(xAdvance) : null}
                  disabled={!editable}
                  onValueChange={editable ? (value) => editor.setXAdvance(value) : undefined}
                  {...metricKeyProps(
                    links,
                    "width",
                    linkOn(linkedSides, "width"),
                    editable,
                    glyph ? Math.round(xAdvance) : null,
                  )}
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
