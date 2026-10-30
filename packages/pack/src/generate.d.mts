/** One item's description, as `#[derive(Pack)]` or `#[pack::interface]` writes it. */
export type Fragment = Record<string, unknown>;

/** Reads every crate's fragments under `folder` (`<folder>/<package>/*.json`). */
export function readFragments(folder: string): Fragment[];

/** Writes the module `render` returns for the fragments under `folder` to `output`. */
export function generate(folder: string, output: string, header?: string): void;

/**
 * The TypeScript module for `fragments`: every interface's class and every
 * type they use.
 *
 * @throws When an interface uses a type no fragment declares, or two crates
 * declare different types under one Rust name.
 */
export function render(fragments: readonly Fragment[], header?: string): string;
