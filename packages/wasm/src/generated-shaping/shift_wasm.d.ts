/* tslint:disable */
/* eslint-disable */

/**
 * Runs one [`Anchors`] method for the editor's generated `Anchors` class.
 */
export function anchorsRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * Runs one [`Axes`] method for the editor's generated `Axes` class.
 */
export function axesRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * The weighted sum of source values: `interpolation::blend_values`.
 *
 * `values` holds each source's values one after another, `lengths[i]`
 * of them for source `i`; a source the editor lacks has length 0. None when
 * there is no source, one has no values, or two differ in length.
 */
export function blendSourceValues(weights: Float64Array, values: Float64Array, lengths: Uint32Array): Float64Array | undefined;

/**
 * Runs one [`Decomposition`] method for the editor's generated
 * `Decomposition` class.
 */
export function decompositionRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * Runs one [`Drag`] method for the editor's generated `Drag` class.
 */
export function dragRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * Runs one [`Geometry`] method for the editor's generated `Geometry` class.
 */
export function geometryRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * Runs one [`IndexKeys`] method for the editor's generated `IndexKeys` class.
 */
export function indexKeysRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * Returns the id of a name, interning it the first time.
 */
export function internName(name: string): number;

/**
 * Returns the name an id stands for; empty for an unknown id.
 */
export function nameOf(id: number): string;

/**
 * Registers a shaper font's bytes and returns its handle. Parses the
 * font's layout tables once; set its glyphs with `setShaperGlyphs`.
 */
export function registerShaper(bytes: Uint8Array): number;

/**
 * Forgets a prepared drag. Releasing an unknown handle does nothing.
 */
export function releaseDrag(handle: number): void;

/**
 * Releases a registered shaper; its handle shapes nothing afterwards.
 */
export function releaseShaper(handle: number): void;

/**
 * Runs one [`Shaping`] method for the editor's generated `Shaping`
 * class.
 */
export function shapingRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

/**
 * Takes the latest reply's blobs, in order; empty once taken.
 */
export function takeReplyBlobs(): Uint8Array[];

/**
 * Runs one [`Variation`] method for the editor's generated `Variation` class.
 */
export function variationRequest(method: number, input: Float64Array, blobs: readonly Uint8Array[] | undefined): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __externref_table_alloc: () => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
    readonly anchorsRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly axesRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly blendSourceValues: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly decompositionRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly dragRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly geometryRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly indexKeysRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly internName: (a: number, b: number) => number;
    readonly memory: WebAssembly.Memory;
    readonly nameOf: (a: number) => [number, number];
    readonly registerShaper: (a: number, b: number) => [number, number, number];
    readonly releaseDrag: (a: number) => void;
    readonly releaseShaper: (a: number) => void;
    readonly shapingRequest: (a: number, b: number, c: number, d: number) => [number, number];
    readonly takeReplyBlobs: () => any;
    readonly variationRequest: (a: number, b: number, c: number, d: number) => [number, number];
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
