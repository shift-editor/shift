/**
 * Shift's shared Rust rules, compiled from `crates/shift-wasm` and instantiated
 * synchronously at import, so reactive computeds can call them directly.
 *
 * @remarks
 * The module is embedded as base64, so the import works unchanged in the
 * desktop renderer, vitest, and the SDK, with no bundler plugin, fetch, or
 * top-level await. Hot calls go through the generated classes exported here
 * ({@link axes}, {@link geometry}, {@link drag}, …), over the module's request exports; the
 * typed wrappers in `@shift/editor` hold handles; the raw exports are for them.
 */
import { syncTransport } from "@shift/pack";
import {
  anchorsRequest,
  axesRequest,
  decompositionRequest,
  dragRequest,
  geometryRequest,
  initSync,
  internName,
  nameOf,
  takeReplyBlobs,
  type InitOutput,
} from "./generated/shift_wasm.js";
import { moduleBase64 } from "./generated/module";
import { embeddedModule } from "./embedded";
import { Anchors, Axes, Decomposition, Drag, Geometry } from "./generated-protocol";
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

// oxlint-disable-next-line eslint-js/no-restricted-syntax -- wasm-bindgen output; its exports change with the Rust crate
export * from "./generated/shift_wasm.js";
