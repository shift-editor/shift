import { useMemo } from "react";
import { computed, useSignalState } from "../lib/signals";
import type { GlyphReapplyMetricsProps } from "../types/glyphReapplyMetrics";
import { Button, RotateCw, Tooltip } from "@shift/ui";

const LABEL = "Re-apply linked metrics";

/**
 * Re-applies the linked metrics of the open glyph at its source.
 *
 * @remarks
 * Glyph scope only: the font-wide re-apply is not offered here. When there is nothing to
 * apply the button stays in place and its tooltip says why.
 */
export function GlyphReapplyMetrics({ font, glyphId, sourceId }: GlyphReapplyMetricsProps) {
  const reasonCell = useMemo(
    () =>
      computed(() => {
        if (!glyphId || !sourceId) return "Open a glyph at a source";

        return font.reapplyLinkedMetricsDisabledReason({ kind: "glyph", glyphId, sourceId });
      }),
    [font, glyphId, sourceId],
  );
  const reason = useSignalState(reasonCell);

  const reapply = () => {
    if (reason !== null || !glyphId || !sourceId) return;

    font.reapplyLinkedMetrics({ kind: "glyph", glyphId, sourceId });
  };

  return (
    <Tooltip content={reason ?? LABEL}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={LABEL}
        aria-disabled={reason !== null}
        className={reason === null ? undefined : "opacity-50"}
        onClick={reapply}
      >
        <RotateCw className="h-3.5 w-3.5" />
      </Button>
    </Tooltip>
  );
}
