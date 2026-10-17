/* tslint:disable */
/* eslint-disable */

/**
 * An anchor's role in mark positioning, as export reads its name.
 */
export class AnchorKind {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The attachment group, such as `top`, for base, mark, and ligature anchors.
     */
    readonly group: string | undefined;
    /**
     * The ligature component or caret number, counting from 1.
     */
    readonly index: number | undefined;
    /**
     * `base`, `mark`, `ligature`, `componentMarker`, `caret`, `vcaret`, `entry`, `exit`, or `invalid`.
     */
    readonly kind: string;
}

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
export function followAnchors(): void;

/**
 * Returns the address of an input buffer of `len` numbers, zeroed.
 */
export function inputBuffer(len: number): number;

/**
 * Returns the id of a name, interning it the first time.
 */
export function internName(name: string): number;

/**
 * Returns the name an id stands for; empty for an unknown id.
 */
export function nameOf(id: number): string;

/**
 * The address of the last call's output.
 */
export function outputBuffer(): number;

/**
 * How many numbers the last call wrote.
 */
export function outputLength(): number;

/**
 * Propagates one glyph's anchors at one location, as export compiles them.
 *
 * Input: `isMark, isLigature, ownCount, (name, x, y)×ownCount, componentCount`,
 * then per component `hasAnchors, baseGlyphCount, xx, xy, yx, yy, dx, dy,
 * anchorCount, (name, x, y)×anchorCount`. Output: `baseGlyphCount, count,
 * (name, x, y)×count`. Names are interned ids.
 */
export function propagateAnchors(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_anchorkind_free: (a: number, b: number) => void;
    readonly anchorKind: (a: number, b: number) => number;
    readonly anchorkind_group: (a: number) => [number, number];
    readonly anchorkind_index: (a: number) => number;
    readonly anchorkind_kind: (a: number) => [number, number];
    readonly followAnchors: () => void;
    readonly propagateAnchors: () => void;
    readonly inputBuffer: (a: number) => number;
    readonly internName: (a: number, b: number) => number;
    readonly nameOf: (a: number) => [number, number];
    readonly outputBuffer: () => number;
    readonly outputLength: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
