import type { AxisId, InterpolationBasis, NamedInstanceId, SourceId } from "@shift/types";

declare const axisLocationSpace: unique symbol;

type AxisLocation<Space extends "external" | "design"> = ReadonlyMap<AxisId, number> & {
  readonly [axisLocationSpace]: Space;
};

/** User-space coordinates used by controls, named instances, and catalog requests. */
export type ExternalAxisLocation = AxisLocation<"external">;

/** Internal coordinates used by authored sources, interpolation, and exact-source matching. */
export type DesignAxisLocation = AxisLocation<"design">;

/**
 * Evaluates a font's variation: its axis mappings, and the weights of the
 * source sets its glyphs interpolate over, at a location.
 *
 * @remarks
 * A `Font` chooses its reader once, as a computed: the window's editing
 * engine while it is open, which builds the mappings and each source set's
 * basis from its own font, or stateless `@shift/wasm` calls that carry the
 * font's axes and bases otherwise. Both run shift-font's evaluators. Readers
 * do not subscribe: {@link Designspace} subscribes for them.
 */
export interface VariationReader {
  /** Maps an external location once, through the font's axis mappings, into design space. */
  toDesign(location: ExternalAxisLocation): DesignAxisLocation;

  /** The external location a design location's mapping came from, on the external axes. */
  toExternal(location: DesignAxisLocation): ExternalAxisLocation;

  /**
   * The number this reader knows `basis`'s source set by, for
   * {@link interpolationWeights}; it stays the set's for the reader's life.
   */
  sourceSet(basis: InterpolationBasis): number;

  /**
   * One weight per source of the source set numbered `set`, in its order, at
   * a design location: shift-font's `InterpolationBasis::weights_at` for the
   * basis the font gives that set.
   *
   * @remarks
   * The result is shared between callers at the same location: read it, don't change it.
   *
   * @returns null when the font's sources give the set no model.
   * @throws When `set` is not a number this reader gave.
   */
  interpolationWeights(set: number, location: DesignAxisLocation): Float64Array | null;
}

/** Identifies the source-creation constraint and control associated with a validation failure. */
export type SourceCreationIssue =
  | { kind: "name"; message: string }
  | { kind: "axis"; axisId: AxisId; message: string }
  | { kind: "location"; sourceId: SourceId; message: string };

/** Identifies the named-instance constraint and control associated with a validation failure. */
export type InstanceCreationIssue =
  | { kind: "name"; message: string }
  | { kind: "axis"; axisId: AxisId; message: string }
  | { kind: "location"; instanceId: NamedInstanceId; message: string };

/** One end of a style label's range: its new minimum or its new maximum. */
export type AxisLabelBound = { readonly minimum: number } | { readonly maximum: number };

/** Whether a style label names one value or a range around it. */
export type AxisLabelKind = "value" | "range";

/** One point of an independent axis mapping, read along its axis. */
export interface AxisMappingCoordinate {
  /** The point's position in the mapping's stored order. */
  readonly index: number;
  /** The user-space value the point maps from. */
  readonly input: number;
  /** The design-space value the point maps to. */
  readonly output: number;
}
