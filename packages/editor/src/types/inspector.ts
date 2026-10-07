import type { Glyph } from "../lib/model/Glyph";
import type { ShiftNode } from "./node";
import type { ShiftId } from "./object";

/**
 * What the inspector describes: one node, and optionally parts of it.
 *
 * @remarks
 * Distinct from the selection, which is what operations act on. The active
 * tool supplies it; see ADR 0002.
 */
export interface Subject {
  readonly node: ShiftNode;
  /** Item, point, or other ids inside `node`; empty means the node itself. */
  readonly parts: readonly ShiftId[];
}

/** A glyph metric the inspector edits: the advance width or one sidebearing. */
export type GlyphMetric = "advance" | "left" | "right";

/** Live glyph metric values; each is null when the glyphs disagree or have no outline. */
export interface GlyphMetricValues {
  readonly lsb: number | null;
  readonly rsb: number | null;
  readonly xAdvance: number | null;
  /** Whether the session can edit, and every glyph has a layer at the active source or location. */
  readonly editable: boolean;
  /** Whether sidebearings can be set: editable, and every glyph has an outline. */
  readonly sidebearingsEditable: boolean;
}

/** Reads and edits the metrics of a set of glyphs as one. */
export interface GlyphMetricsTarget {
  /** The glyphs described, each once. */
  readonly glyphs: readonly Glyph[];
  /** Reactive: reruns a reader when a value, the source, or the location changes. */
  values(): GlyphMetricValues;
  /** Sets one metric on every glyph's layer at the active source, as one undo step. */
  set(metric: GlyphMetric, value: number): void;
}

/** One block of the inspector, as a node definition returns it. */
export type InspectorSection = {
  readonly kind: "glyphMetrics";
  readonly metrics: GlyphMetricsTarget;
};
