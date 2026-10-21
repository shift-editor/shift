import type * as ShapingModuleExports from "./shapingModule";

/** The shaping module's editor wrapper, loaded on first use. */
type ShapingModule = typeof ShapingModuleExports;

let loading: Promise<ShapingModule> | null = null;

/**
 * Loads `@shift/wasm/shaping` and its wrapper, once.
 *
 * @remarks
 * The module is several times the size of `@shift/wasm`, so it is imported
 * dynamically: bundlers split it into a chunk of its own, which loads when
 * text first needs shaping rather than with the editor.
 */
export function loadShaping(): Promise<ShapingModule> {
  loading ??= import("./shapingModule");
  return loading;
}

export type { RegisteredShaper } from "./shapingModule";
