//! The edits the editor sends its editing engine, as shift-font's own
//! intents, and the font-level records each edit changed.
//!
//! The [`EngineEdits`] interface is answered only with the `engine` feature,
//! beside the session it feeds ([`crate::engine`]). It is declared with
//! `engine-protocol` alone, so the editor's side generates without building
//! the session.
//!
//! Intents cross packed, with their ids as names in the engine module's name
//! table, and wait in the session until the `engineApply`, `engineStage` or
//! `enginePreview` call that follows takes them. Those calls return the
//! layers the edit touched as objects; the font-level records an apply, undo
//! or redo changed cross packed through [`EngineEdits::replacement`], in the
//! same shape as the native workspace's echo.

use shift_font::FontIntent;
use shift_wire::replacement::FontReplacement;

/// The intents one engine session applies next, and what its latest edit
/// changed at font level.
#[pack::interface]
pub trait EngineEdits {
    /// Holds `intents` for the session's next `engineApply`, `engineStage` or
    /// `enginePreview`, in place of any held before.
    fn hold(&mut self, intents: Vec<FontIntent>);
    /// Takes the font-level records the latest `engineApply`, `engineUndo` or
    /// `engineRedo` changed, whole; null when it changed none, or once taken.
    fn replacement(&mut self) -> Option<FontReplacement>;
}

#[cfg(feature = "engine")]
mod exports {
    use shift_font::FontIntent;
    use shift_wire::replacement::FontReplacement;
    use wasm_bindgen::prelude::*;

    use super::{EngineEdits, engine_edits_request};
    use crate::engine::{Engine, with_engine};

    /// Runs one [`EngineEdits`] method on the session `handle`. An unknown
    /// handle replies with nothing.
    #[wasm_bindgen(js_name = engineEditsRequest)]
    pub fn request(
        handle: u32,
        method: u32,
        input: &[f64],
        #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
            js_sys::Array,
        >,
    ) -> Vec<f64> {
        with_engine(handle, |engine| {
            Ok(crate::blobs::answer(blobs, |blobs, names| {
                engine_edits_request(&mut *engine, method, input, blobs, names)
            }))
        })
        .unwrap_or_default()
    }

    impl EngineEdits for Engine {
        fn hold(&mut self, intents: Vec<FontIntent>) {
            self.held = intents;
        }

        fn replacement(&mut self) -> Option<FontReplacement> {
            self.replaced.take()
        }
    }
}
