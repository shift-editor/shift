//! Text laid out as typed over a font the window has no engine for, such as
//! a preview's, by the same shift-layout code the engine lays text out with
//! (`TextLayout::new` over `LayoutFont::typed`). Answered in the engine
//! module only, which holds shift-layout; the call is stateless.

use shift_layout::{LayoutError, LayoutRequest, TextLayout, TypedFont};

/// Text laid out over what a window knows of a font without its engine.
#[pack::interface]
pub trait TypedText {
    /// `text` laid out as typed over `font`, as `shift_layout::TextLayout`
    /// lays out text it cannot shape: one glyph per unit at its advance, a
    /// mark of no advance at the editor's stand-in, lines at each line break
    /// and the request's width, aligned, with caret stops, and the reason it
    /// was not shaped.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError::TooLong`] for text too long to index.
    fn layout_typed(&self, text: LayoutRequest, font: TypedFont)
    -> Result<TextLayout, LayoutError>;
}

#[cfg(feature = "engine")]
mod exports {
    use shift_layout::{LayoutError, LayoutFont, LayoutRequest, TextLayout, TypedFont};
    use wasm_bindgen::prelude::wasm_bindgen;

    use super::{TypedText, typed_text_request};

    /// The layout [`TypedText`] calls.
    pub struct TypedLayout;

    impl TypedText for TypedLayout {
        fn layout_typed(
            &self,
            text: LayoutRequest,
            font: TypedFont,
        ) -> Result<TextLayout, LayoutError> {
            TextLayout::new(&LayoutFont::typed(&font), &text)
        }
    }

    /// Runs one [`TypedText`] method for the editor's generated `TypedText`
    /// class.
    #[wasm_bindgen(js_name = typedTextRequest)]
    pub fn request(
        method: u32,
        input: &[f64],
        #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
            js_sys::Array,
        >,
    ) -> Vec<f64> {
        crate::blobs::answer(blobs, |blobs, names| {
            typed_text_request(&TypedLayout, method, input, blobs, names)
        })
    }
}
