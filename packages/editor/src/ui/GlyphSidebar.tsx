import { Button, Separator } from "@shift/ui";
import type { ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { EditableSidebarInput } from "./EditableSidebarInput";
import { ShiftIcon } from "./ShiftIcon";
import type { EditorUISession } from "./types";

export interface GlyphSidebarHost {
  header?: ReactNode;
  selection?: ReactNode;
}

export interface GlyphSidebarProps {
  session: EditorUISession;
  host?: GlyphSidebarHost;
}

export function GlyphSidebar({ session, host }: GlyphSidebarProps) {
  const { editor, font } = session;
  const metadata = useSignalState(font.metadataCell);
  const scene = useSignalState(editor.scene.cell);
  const location = useSignalState(editor.externalLocationCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const zoom = useSignalState(editor.zoomCell);

  const glyphNode = scene.nodes.find((node) => node.kind === "glyph");
  const glyph = glyphNode ? editor.glyphForId(glyphNode.glyphId) : null;
  const glyphName = glyph ? glyph.name : "—";
  const unicode = glyph ? glyph.unicode : null;
  const geometry = glyph ? glyph.geometryAt(location) : null;
  const bounds = geometry?.bounds;
  const advance = geometry?.xAdvance ?? 0;
  const leftSidebearing = bounds?.min.x ?? null;
  const rightSidebearing = bounds ? advance - bounds.max.x : null;
  const hasLayer = activeSourceId !== null;

  return (
    <aside
      aria-label="Glyph properties"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-line-subtle bg-panel"
    >
      <div className="flex items-center justify-between px-3 py-2">
        {host?.header ?? (
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
            <h3 className="text-ui font-medium text-[#232323]">Glyph</h3>
            <main className="flex flex-col items-center">
              <div className="mb-2 flex flex-col items-center gap-0.5">
                <div className="font-mono text-sm">
                  {unicode === null
                    ? "—"
                    : `U+${unicode.toString(16).toUpperCase().padStart(4, "0")}`}
                </div>
              </div>
              <div className="flex items-center justify-center gap-2">
                <EditableSidebarInput
                  ariaLabel="Left sidebearing"
                  label="LSB"
                  className="text-right"
                  value={leftSidebearing === null ? null : Math.round(leftSidebearing)}
                  disabled={!hasLayer || leftSidebearing === null}
                  onValueChange={hasLayer ? (value) => editor.setLeftSidebearing(value) : undefined}
                />
                <div className="px-2">
                  <ShiftIcon name="placeholder-glyph" className="h-[55px] w-8" />
                </div>
                <EditableSidebarInput
                  ariaLabel="Right sidebearing"
                  label="RSB"
                  labelPosition="right"
                  className="text-left"
                  value={rightSidebearing === null ? null : Math.round(rightSidebearing)}
                  disabled={!hasLayer || rightSidebearing === null}
                  onValueChange={
                    hasLayer ? (value) => editor.setRightSidebearing(value) : undefined
                  }
                />
              </div>
              <div className="mt-2">
                <EditableSidebarInput
                  ariaLabel="Advance width"
                  className="text-center"
                  value={glyph ? Math.round(advance) : null}
                  disabled={!hasLayer}
                  onValueChange={hasLayer ? (value) => editor.setXAdvance(value) : undefined}
                />
              </div>
              <div className="mt-2 font-sans text-sm">{glyphName}</div>
            </main>
          </section>
        </div>
        {host?.selection}
      </div>
    </aside>
  );
}
