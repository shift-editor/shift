//! Test-only exports: shift-font's answers for the rules the editor keeps in
//! TypeScript, so its tests compare the two on the same inputs.
//!
//! Built only with the `reference` feature, into `@shift/wasm/reference`,
//! which the app and the SDK never import. Each export converts its input to
//! shift-font types, calls the function native callers use, and converts the
//! result back; none has logic of its own, so a mismatch is always a
//! TypeScript bug or a real divergence, never a bug here.
//!
//! These are cold calls with structured values, typed with tsify.

mod axis_mapping;
