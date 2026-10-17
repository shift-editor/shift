/* tslint:disable */
/* eslint-disable */
/**
 * A font's compiled axis mappings, in order.
 */
export type AxisMappingBases = AxisMappingBasisData[];

/**
 * A variation basis Rust compiled.
 */
export interface VariationBasisData {
    deltas: VariationBasisDelta[];
}

/**
 * An anchor's role in mark positioning, as export reads its name.
 */
export type AnchorKind = { kind: "base"; group: string } | { kind: "mark"; group: string } | { kind: "ligature"; group: string; index: number } | { kind: "componentMarker"; index: number } | { kind: "caret"; index: number } | { kind: "vcaret"; index: number } | { kind: "entry" } | { kind: "exit" } | { kind: "invalid" };

/**
 * An axis as variation reads it; the editor's `Axis` satisfies this.
 */
export interface VariationAxis {
    id: string;
    tag: string;
    name: string;
    role: VariationAxisRole;
    axisType: VariationAxisType;
    minimum?: number;
    default: number;
    maximum?: number;
    values?: number[];
}

/**
 * An axis mapping Rust compiled.
 */
export interface AxisMappingBasisData {
    mappingId: string;
    inputAxisIds: string[];
    outputAxisIds: string[];
    basis: VariationBasisData;
}

/**
 * Axes in order.
 */
export type VariationAxes = VariationAxis[];

/**
 * Design-space bounds that normalize one axis for interpolation.
 */
export interface VariationDesignNormalization {
    axisId: string;
    minimum: number;
    default: number;
    maximum: number;
}

/**
 * One axis's support within a region, normalized.
 */
export interface VariationSupport {
    axisId: string;
    lower: number;
    peak: number;
    upper: number;
}

/**
 * One contribution: a region and the values it adds there.
 */
export interface VariationBasisDelta {
    region: VariationSupport[];
    values: Float64Array | number[];
}

/**
 * Source weights Rust compiled for an ordered source set.
 */
export interface InterpolationBasisData {
    sourceIds: string[];
    basis: VariationBasisData;
    designNormalization: VariationDesignNormalization[];
}

export type VariationAxisRole = "external" | "internal";

export type VariationAxisType = "continuous" | "discrete";


/**
 * Returns the kind fontc reads from an anchor name.
 */
export function anchorKind(name: string): AnchorKind;

/**
 * Converts a normalized coordinate on one registered axis back to its design value.
 */
export function denormalizeAxis(axes: number, index: number, value: number): number;

/**
 * Maps a location through one registered mapping; its output axes' values in its output order.
 */
export function evaluateAxisMapping(mappings: number, index: number, axes: number, location: Float64Array): Float64Array;

/**
 * A variation basis's values at a location, normalized by each axis's range.
 */
export function evaluateVariationBasis(basis: number, axes: number, location: Float64Array): Float64Array;

/**
 * Places a composite's components after an edit, anchored ones on their anchors.
 *
 * Input: `count`, then per component `alignment (0 unset, 1 anchored, 2 free),
 * hasAccepted, transform×9, acceptedTransform×9, anchorCount, (name, x, y)×,
 * acceptedAnchorCount, (name, x, y)×`, transforms decomposed in interpolation
 * order and anchors the component glyph's own, a name of -1 for an unnamed
 * one. Output: per component `alignment, transform×9`.
 */
export function followAnchors(input: Float64Array): Float64Array;

/**
 * Returns the id of a name, interning it the first time.
 */
export function internName(name: string): number;

/**
 * One weight per source of an interpolation basis at a design location.
 *
 * A region naming an axis the basis or `axes` lack contributes nothing.
 */
export function interpolationWeights(basis: number, axes: number, location: Float64Array): Float64Array;

/**
 * Maps an external location to its design location, in `axes` order.
 */
export function mapAxisLocation(mappings: number, axes: number, external: Float64Array): Float64Array;

/**
 * Returns the name an id stands for; empty for an unknown id.
 */
export function nameOf(id: number): string;

/**
 * Propagates one glyph's anchors at one location, as export compiles them.
 *
 * Input: `isMark, isLigature, ownCount, (name, x, y)×ownCount, componentCount`,
 * then per component `hasAnchors, baseGlyphCount, xx, xy, yx, yy, dx, dy,
 * anchorCount, (name, x, y)×anchorCount`. Output: `baseGlyphCount, count,
 * (name, x, y)×count`. Names are interned ids.
 */
export function propagateAnchors(input: Float64Array): Float64Array;

/**
 * Registers axes in order, for locations passed as numbers in that order.
 */
export function registerAxes(axes: VariationAxes): number;

/**
 * Registers a font's axis mappings, in order.
 */
export function registerAxisMappings(bases: AxisMappingBases): number;

/**
 * Registers an interpolation basis.
 */
export function registerInterpolationBasis(basis: InterpolationBasisData): number;

/**
 * Registers a variation basis evaluated with each axis's own range.
 */
export function registerVariationBasis(basis: VariationBasisData): number;

export function releaseAxes(handle: number): void;

export function releaseAxisMappings(handle: number): void;

export function releaseInterpolationBasis(handle: number): void;

export function releaseVariationBasis(handle: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly evaluateAxisMapping: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly evaluateVariationBasis: (a: number, b: number, c: number, d: number) => [number, number];
    readonly interpolationWeights: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mapAxisLocation: (a: number, b: number, c: number, d: number) => [number, number];
    readonly registerAxes: (a: any) => [number, number, number];
    readonly registerAxisMappings: (a: any) => [number, number, number];
    readonly registerInterpolationBasis: (a: any) => [number, number, number];
    readonly registerVariationBasis: (a: any) => [number, number, number];
    readonly releaseAxes: (a: number) => void;
    readonly releaseAxisMappings: (a: number) => void;
    readonly releaseInterpolationBasis: (a: number) => void;
    readonly releaseVariationBasis: (a: number) => void;
    readonly denormalizeAxis: (a: number, b: number, c: number) => number;
    readonly internName: (a: number, b: number) => number;
    readonly nameOf: (a: number) => [number, number];
    readonly anchorKind: (a: number, b: number) => [number, number, number];
    readonly followAnchors: (a: number, b: number) => [number, number];
    readonly propagateAnchors: (a: number, b: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
