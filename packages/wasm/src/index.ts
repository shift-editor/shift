/**
 * Shift's shared Rust rules, compiled from `crates/shift-wasm` and instantiated
 * synchronously at import, so reactive computeds can call them directly.
 *
 * @remarks
 * The module is embedded as base64, so the import works unchanged in the
 * desktop renderer, vitest, and the SDK, with no bundler plugin, fetch, or
 * top-level await. Use the typed wrappers in `@shift/editor`, which pack
 * inputs, intern names, and hold handles; the raw exports are for them.
 */
import { initSync, type InitOutput } from "./generated/shift_wasm.js";
import { moduleBase64 } from "./generated/module";
import { embeddedModule } from "./embedded";

/** The instantiated module's exports, including its memory. */
export const wasm: InitOutput = initSync({ module: embeddedModule(moduleBase64) });

// oxlint-disable-next-line eslint-js/no-restricted-syntax -- wasm-bindgen output; its exports change with the Rust crate
export * from "./generated/shift_wasm.js";
