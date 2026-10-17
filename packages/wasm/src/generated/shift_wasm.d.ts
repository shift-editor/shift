/* tslint:disable */
/* eslint-disable */
/**
 * An anchor's role in mark positioning, as export reads its name.
 */
export type AnchorKind = { kind: "base"; group: string } | { kind: "mark"; group: string } | { kind: "ligature"; group: string; index: number } | { kind: "componentMarker"; index: number } | { kind: "caret"; index: number } | { kind: "vcaret"; index: number } | { kind: "entry" } | { kind: "exit" } | { kind: "invalid" };


/**
 * Returns the kind fontc reads from an anchor name.
 */
export function anchorKind(name: string): AnchorKind;

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly internName: (a: number, b: number) => number;
    readonly nameOf: (a: number) => [number, number];
    readonly anchorKind: (a: number, b: number) => [number, number, number];
    readonly followAnchors: (a: number, b: number) => [number, number];
    readonly propagateAnchors: (a: number, b: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
