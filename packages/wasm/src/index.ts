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

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The instantiated module's exports, including its memory. */
export const wasm: InitOutput = initSync({ module: new WebAssembly.Module(decode(moduleBase64)) });

export * from "./generated/shift_wasm.js";
