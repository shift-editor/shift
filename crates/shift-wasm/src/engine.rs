//! The editing engine: an [`EngineSession`] over the open font that applies
//! the editor's intents synchronously, in the frame they are made.
//!
//! Layers load on demand through an [`EngineLayerSource`] the editor passes
//! in, which reads the store synchronously. Intents arrive in the same shape
//! the native workspace takes (`shift_wire::intents`), and each touched layer
//! comes back in the same shape as the workspace's echo.

use std::cell::RefCell;

use js_sys::{Array, Float64Array, Object, Reflect, Uint8Array};
use shift_engine::{ApplyError, EngineSession, LayerSource};
use shift_font::{Font, FontIntent, FontIntentSet, GlyphId, GlyphLayer, LayerId, TouchedLayer};
use shift_wire::{GlyphState, intents};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const ENGINE_TYPES: &str = r#"
import type { FontIntent, GlyphStructure, LayerId } from "@shift/types";

/**
 * Where an engine session reads layers it has not loaded: the saved and
 * persisted store, read synchronously. It must not call back into the engine.
 */
export interface EngineLayerSource {
  /** The content of `layerIds` as one MessagePack array of named-field layers. */
  load(layerIds: string[]): Uint8Array;
  /** `glyphIds` plus every glyph their components use, transitively. */
  componentClosure(glyphIds: string[]): string[];
  /** Glyphs with a component of a glyph that owns one of `layerIds`. */
  dependents(layerIds: string[]): string[];
}

/** One layer an edit touched, as the workspace's echo carries it. */
export interface EngineLayer {
  layerId: LayerId;
  structure: GlyphStructure;
  values: Float64Array;
  /** Whether the edit changed the layer's structure, not only its values. */
  structural: boolean;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// The editor's synchronous reader of the store.
    #[wasm_bindgen(typescript_type = "EngineLayerSource")]
    pub type EngineLayerSource;

    #[wasm_bindgen(method, catch)]
    fn load(this: &EngineLayerSource, layer_ids: Array) -> Result<Uint8Array, JsValue>;

    #[wasm_bindgen(method, catch, js_name = componentClosure)]
    fn component_closure(this: &EngineLayerSource, glyph_ids: Array) -> Result<Array, JsValue>;

    #[wasm_bindgen(method, catch)]
    fn dependents(this: &EngineLayerSource, layer_ids: Array) -> Result<Array, JsValue>;
}

/// Why the editor's source failed to answer.
#[derive(Debug, thiserror::Error)]
enum HostError {
    #[error("the layer source threw: {0}")]
    Threw(String),

    #[error("the layer source returned layers that do not decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),

    #[error("the layer source returned an invalid {kind}: {value}")]
    InvalidId {
        kind: intents::IdKind,
        value: String,
    },
}

impl From<JsValue> for HostError {
    fn from(thrown: JsValue) -> Self {
        Self::Threw(format!("{thrown:?}"))
    }
}

impl From<intents::WireError> for HostError {
    fn from(error: intents::WireError) -> Self {
        match error {
            intents::WireError::InvalidId { kind, value } => Self::InvalidId { kind, value },
            other => Self::Threw(other.to_string()),
        }
    }
}

/// The editor's source as the session's [`LayerSource`].
struct HostLayers<'a>(&'a EngineLayerSource);

impl LayerSource for HostLayers<'_> {
    type Error = HostError;

    fn load_layers(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphLayer>, HostError> {
        let bytes = self.0.load(texts(layer_ids))?;
        Ok(rmp_serde::from_slice(&bytes.to_vec())?)
    }

    fn component_closure(&mut self, roots: &[GlyphId]) -> Result<Vec<GlyphId>, HostError> {
        ids(&self.0.component_closure(texts(roots))?)
    }

    fn dependents(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphId>, HostError> {
        ids(&self.0.dependents(texts(layer_ids))?)
    }
}

/// Ids as the JavaScript strings the source takes.
fn texts<T: ToString>(values: &[T]) -> Array {
    values
        .iter()
        .map(|value| JsValue::from_str(&value.to_string()))
        .collect()
}

/// Glyph ids from the JavaScript strings the source returns.
fn ids(values: &Array) -> Result<Vec<GlyphId>, HostError> {
    let texts: Vec<String> = values
        .iter()
        .filter_map(|value| value.as_string())
        .collect();
    Ok(intents::parse_id_list::<GlyphId>(&texts)?)
}

/// An open session and the source it reads from.
struct Engine {
    session: EngineSession,
    source: EngineLayerSource,
}

thread_local! {
    static ENGINES: RefCell<Vec<Option<Engine>>> = const { RefCell::new(Vec::new()) };
}

/// Runs `edit` on the engine at `handle`.
fn with_engine<T>(
    handle: u32,
    edit: impl FnOnce(&mut Engine) -> Result<T, JsError>,
) -> Result<T, JsError> {
    ENGINES.with_borrow_mut(|engines| {
        let engine = usize::try_from(handle)
            .ok()
            .and_then(|index| engines.get_mut(index))
            .and_then(Option::as_mut)
            .ok_or_else(|| JsError::new(&format!("no engine {handle}")))?;
        edit(engine)
    })
}

/// Opens a session over a font directory, as named MessagePack from the
/// store's reader, with every layer a placeholder. Returns its handle.
///
/// # Errors
///
/// Fails when `directory` does not decode to a font.
#[wasm_bindgen(js_name = engineOpen)]
pub fn engine_open(directory: &[u8], source: EngineLayerSource) -> Result<u32, JsError> {
    let font: Font = rmp_serde::from_slice(directory)?;
    let session = EngineSession::open_directory(font);
    ENGINES.with_borrow_mut(|engines| {
        let handle = u32::try_from(engines.len())?;
        engines.push(Some(Engine { session, source }));
        Ok(handle)
    })
}

/// Applies `intents`, in the shape the workspace takes, as one edit: loads
/// what they read, applies them, and returns every layer they touched.
///
/// # Errors
///
/// Fails when an intent does not decode, when the source fails, or when the
/// edit is invalid; the session is then as loading left it.
#[wasm_bindgen(js_name = engineApply, unchecked_return_type = "EngineLayer[]")]
pub fn engine_apply(
    handle: u32,
    #[wasm_bindgen(unchecked_param_type = "FontIntent[]")] intents: JsValue,
) -> Result<Array, JsError> {
    let wire: Vec<intents::FontIntent> = serde_wasm_bindgen::from_value(intents)?;
    let set = FontIntentSet {
        intents: wire
            .into_iter()
            .map(FontIntent::try_from)
            .collect::<Result<_, _>>()?,
    };
    with_engine(handle, |engine| {
        let applied = engine
            .session
            .apply(&mut HostLayers(&engine.source), &set)
            .map_err(|error| match error {
                ApplyError::Load(error) => JsError::new(&error.to_string()),
                ApplyError::Engine(error) => JsError::new(&error.to_string()),
            })?;
        applied.layers.iter().map(engine_layer).collect()
    })
}

/// Drops the loaded layers of `glyph_ids`, so the next edit that reads them
/// loads them from the store again.
///
/// # Errors
///
/// Fails on an unknown handle or glyph id.
#[wasm_bindgen(js_name = engineEvict)]
pub fn engine_evict(handle: u32, glyph_ids: Vec<String>) -> Result<(), JsError> {
    let glyph_ids = intents::parse_id_list::<GlyphId>(&glyph_ids)?;
    with_engine(handle, |engine| Ok(engine.session.evict(&glyph_ids)?))
}

/// Releases a session; its handle applies nothing afterwards.
#[wasm_bindgen(js_name = engineRelease)]
pub fn engine_release(handle: u32) {
    ENGINES.with_borrow_mut(|engines| {
        if let Some(slot) = usize::try_from(handle)
            .ok()
            .and_then(|index| engines.get_mut(index))
        {
            *slot = None;
        }
    });
}

/// One touched layer as an `EngineLayer` object.
fn engine_layer(touched: &TouchedLayer) -> Result<JsValue, JsError> {
    let state = GlyphState::from_layer(&touched.layer);
    let layer = Object::new();
    set(
        &layer,
        "layerId",
        &JsValue::from_str(state.layer_id.as_str()),
    )?;
    set(
        &layer,
        "structure",
        &serde_wasm_bindgen::to_value(&state.structure)?,
    )?;
    set(&layer, "values", &Float64Array::from(&state.values[..]))?;
    set(
        &layer,
        "structural",
        &JsValue::from_bool(touched.structural),
    )?;
    Ok(layer.into())
}

fn set(object: &Object, key: &str, value: &JsValue) -> Result<(), JsError> {
    Reflect::set(object, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| JsError::new(&format!("cannot set {key}")))
}
