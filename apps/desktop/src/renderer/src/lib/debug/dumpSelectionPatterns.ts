import { diagnoseSelectionPatterns } from "@shift/rules";
import { getEditor } from "@/store/store";

export function dumpSelectionPatternsToConsole(): void {
  const editor = getEditor();
  const glyph = editor.glyph.peek();
  const selectedPointIds = editor.getSelectedPoints();

  if (!glyph) {
    console.warn("[rules] Cannot dump selection patterns: no active glyph");
    return;
  }

  const diagnostics = diagnoseSelectionPatterns(glyph, new Set(selectedPointIds));
  const rows = diagnostics.points.map((point) => ({
    pointId: point.pointId,
    contourId: point.contourId ?? "(missing)",
    pointIndex: point.pointIndex ?? -1,
    probes: point.probes
      .map((probe) => `${probe.windowSize}:${probe.pattern}${probe.matched ? " *" : ""}`)
      .join(" | "),
    matchedRule: point.matchedRule?.ruleId ?? "",
    matchedPattern: point.matchedRule?.pattern ?? "",
    affected: point.matchedRule
      ? Object.entries(point.matchedRule.affected)
          .map(([role, pointId]) => `${role}:${pointId}`)
          .join(", ")
      : "",
  }));

  console.groupCollapsed(`[rules] Selection Pattern Diagnostics (${rows.length} selected points)`);
  if (rows.length === 0) {
    console.info("[rules] No selected points");
  } else {
    console.table(rows);
  }
  console.debug("[rules] Full diagnostics payload", diagnostics);
  console.groupEnd();
}
