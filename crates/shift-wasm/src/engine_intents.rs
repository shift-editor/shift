//! The edits the editor sends its editing engine, as shift-font's own
//! intents.
//!
//! The [`EngineIntents`] interface is answered only with the `engine`
//! feature, beside the session it feeds ([`crate::engine`]). It is declared
//! either way, so the editor's side generates without the feature.
//!
//! Intents cross packed, with their ids as names in the engine module's name
//! table, and wait in the session until the `engineApply`, `engineStage` or
//! `enginePreview` call that follows takes them: those calls return what the
//! edit touched as objects the editor reads directly.

use shift_font::FontIntent;

/// The intents one engine session applies next.
#[pack::interface]
pub trait EngineIntents {
    /// Holds `intents` for the session's next `engineApply`, `engineStage` or
    /// `enginePreview`, in place of any held before.
    fn hold(&mut self, intents: Vec<FontIntent>);
}

#[cfg(feature = "engine")]
mod exports {
    use shift_font::FontIntent;
    use wasm_bindgen::prelude::*;

    use super::{EngineIntents, engine_intents_request};
    use crate::engine::{Engine, with_engine};

    /// Runs one [`EngineIntents`] method on the session `handle`. An unknown
    /// handle replies with nothing.
    #[wasm_bindgen(js_name = engineIntentsRequest)]
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
                engine_intents_request(&mut *engine, method, input, blobs, names)
            }))
        })
        .unwrap_or_default()
    }

    impl EngineIntents for Engine {
        fn hold(&mut self, intents: Vec<FontIntent>) {
            self.held = intents;
        }
    }
}
