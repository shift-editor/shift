/**
 * Shift's shared Rust rules, compiled from `crates/shift-wasm` and instantiated
 * synchronously at import, so reactive computeds can call them directly.
 *
 * @remarks
 * The module is embedded as base64, so the import works unchanged in the
 * desktop renderer, vitest, and the SDK, with no bundler plugin, fetch, or
 * top-level await. Hot calls go through the generated classes exported here
 * ({@link axes}, {@link geometry}, {@link drag}, …), over the module's request
 * exports; the raw exports are for the typed wrappers in `@shift/editor`.
 */
import { syncTransport } from "@shift/pack";
import {
  anchorsRequest,
  axesRequest,
  decompositionRequest,
  dragRequest,
  geometryRequest,
  indexKeysRequest,
  initSync,
  internName,
  nameOf,
  proofTextsRequest,
  scenesRequest,
  takeReplyBlobs,
  variationRequest,
  type InitOutput,
} from "./generated/shift_wasm.js";
import { moduleBase64 } from "./generated/module";
import { embeddedModule } from "./embedded";
import {
  Anchors,
  Axes,
  Decomposition,
  Drag,
  Geometry,
  IndexKeys,
  ProofTexts,
  Scenes,
  Variation,
} from "./generated-protocol";
import { moduleNames } from "./names";

/** The instantiated module's exports, including its memory. */
export const wasm: InitOutput = initSync({ module: embeddedModule(moduleBase64) });

const names = moduleNames(internName, nameOf);

/** Anchor propagation and placement, as export and the workspace run them. */
export const anchors = new Anchors(syncTransport(anchorsRequest, names, takeReplyBlobs));
/** An axis's range and the positions it allows, as shift-font decides them. */
export const axes = new Axes(syncTransport(axesRequest, names, takeReplyBlobs));
/** Component outlines between masters, as compilers interpolate a decomposed glyph. */
export const decomposition = new Decomposition(
  syncTransport(decompositionRequest, names, takeReplyBlobs),
);
/** shift-font's drag rules: matched when a drag starts, then run once per frame. */
export const drag = new Drag(syncTransport(dragRequest, names, takeReplyBlobs));
/** A contour's segments and bounds, and a component's placement, as shift-font computes them. */
export const geometry = new Geometry(syncTransport(geometryRequest, names, takeReplyBlobs));
/** The keys that order a scene node among its siblings, as shift-font makes and compares them. */
export const indexKeys = new IndexKeys(syncTransport(indexKeysRequest, names, takeReplyBlobs));
/**
 * Proof text read and written as shift-font's `ProofText` does: `/name`
 * picks a glyph by name, ending at a space it consumes or the next `/`; `//`
 * is a slash.
 */
export const proofTexts = new ProofTexts(syncTransport(proofTextsRequest, names, takeReplyBlobs));
/**
 * Scenes held apart from any editing engine, for a session that has none:
 * shift-engine's scene, with nothing persisted.
 */
export const scenes = new Scenes(syncTransport(scenesRequest, names, takeReplyBlobs));
/**
 * Axis mapping, interpolation weights and compiled deltas for a font without
 * an editing engine, each call carrying the axes and bases it evaluates.
 */
export const variation = new Variation(syncTransport(variationRequest, names, takeReplyBlobs));

// oxlint-disable-next-line eslint-js/no-restricted-syntax -- wasm-bindgen output; its exports change with the Rust crate
export * from "./generated/shift_wasm.js";
