//! SPIKE: a renderer-resident editing engine over shift-font's own `Font`.
//!
//! Holds the workspace directory (every glyph and layer identity, with empty
//! placeholder layers) plus the layers the editor has loaded, and applies
//! intents with `Font::apply_intents`, the same code the workspace runs. The
//! editor publishes the returned layer states exactly as it publishes echoes.
//!
//! Not production code: only the intents the spike routes are converted.

use std::cell::RefCell;

use serde::{Deserialize, Serialize};
use shift_font::{
    ContourId, DesignLocation, Font, FontIntent, FontIntentSet, Glyph, GlyphId, GlyphLayer,
    LayerId, PointId, Source, SourceId,
};
use shift_wire::{state::layer_from_state, GlyphState, GlyphStructure};
use wasm_bindgen::prelude::*;

thread_local! {
    static ENGINE: RefCell<Option<Font>> = const { RefCell::new(None) };
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectorySource {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryLayer {
    id: String,
    source_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryGlyph {
    id: String,
    name: String,
    #[serde(default)]
    unicodes: Vec<u32>,
    layers: Vec<DirectoryLayer>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Directory {
    glyphs: Vec<DirectoryGlyph>,
    sources: Vec<DirectorySource>,
}

fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

fn parse<T: std::str::FromStr>(value: &str) -> Result<T, JsError>
where
    T::Err: std::fmt::Display,
{
    value.parse().map_err(js_error)
}

/// Builds the engine's font from a workspace snapshot: identities only.
#[wasm_bindgen(js_name = engineOpen)]
pub fn engine_open(snapshot: JsValue) -> Result<(), JsError> {
    let directory: Directory = serde_wasm_bindgen::from_value(snapshot).map_err(js_error)?;
    let mut font = Font::empty();
    for source in &directory.sources {
        font.add_source(Source::with_id(
            parse(&source.id)?,
            source.name.clone(),
            DesignLocation::new(),
            None,
        ));
    }
    if let Some(first) = directory.sources.first() {
        font.set_default_source_id(parse(&first.id)?);
    }
    for record in &directory.glyphs {
        let mut glyph = Glyph::with_id(parse::<GlyphId>(&record.id)?, record.name.as_str());
        glyph.set_unicodes(record.unicodes.clone());
        for layer in &record.layers {
            glyph.set_layer(GlyphLayer::new(
                parse::<LayerId>(&layer.id)?,
                parse::<SourceId>(&layer.source_id)?,
            ));
        }
        font.insert_glyph(glyph).map_err(js_error)?;
    }
    ENGINE.with(|engine| *engine.borrow_mut() = Some(font));
    Ok(())
}

/// Installs a loaded or replaced layer's authored state.
#[wasm_bindgen(js_name = engineInstallLayer)]
pub fn engine_install_layer(
    layer_id: &str,
    structure: JsValue,
    values: &[f64],
) -> Result<(), JsError> {
    let structure: GlyphStructure = serde_wasm_bindgen::from_value(structure).map_err(js_error)?;
    let layer_id: LayerId = parse(layer_id)?;
    ENGINE.with(|engine| {
        let mut engine = engine.borrow_mut();
        let font = engine
            .as_mut()
            .ok_or_else(|| js_error("engine is not open"))?;
        let source_id = font.require_layer(&layer_id).map_err(js_error)?.source_id();
        let layer = layer_from_state(layer_id, source_id, &structure, values).map_err(js_error)?;
        font.replace_glyph_layers(vec![layer]).map_err(js_error)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReverseContourPayload {
    layer_id: String,
    contour_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemovePointsPayload {
    layer_id: String,
    point_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireIntent {
    kind: String,
    reverse_contour: Option<ReverseContourPayload>,
    remove_points: Option<RemovePointsPayload>,
}

fn font_intent(wire: WireIntent) -> Result<FontIntent, JsError> {
    match (wire.kind.as_str(), wire.reverse_contour, wire.remove_points) {
        ("reverseContour", Some(payload), _) => Ok(FontIntent::ReverseContour {
            layer_id: parse(&payload.layer_id)?,
            contour_id: parse::<ContourId>(&payload.contour_id)?,
        }),
        ("removePoints", _, Some(payload)) => Ok(FontIntent::RemovePoints {
            layer_id: parse(&payload.layer_id)?,
            point_ids: payload
                .point_ids
                .iter()
                .map(|id| parse::<PointId>(id))
                .collect::<Result<_, _>>()?,
        }),
        (kind, _, _) => Err(js_error(format!("spike engine does not route {kind}"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TouchedLayer {
    structural: bool,
    state: GlyphState,
}

/// Applies wire intents through `Font::apply_intents` and returns every touched layer.
#[wasm_bindgen(js_name = engineApply)]
pub fn engine_apply(intents: JsValue) -> Result<JsValue, JsError> {
    let wire: Vec<WireIntent> = serde_wasm_bindgen::from_value(intents).map_err(js_error)?;
    let intents = wire
        .into_iter()
        .map(font_intent)
        .collect::<Result<Vec<_>, _>>()?;
    let touched = ENGINE.with(|engine| {
        let mut engine = engine.borrow_mut();
        let font = engine
            .as_mut()
            .ok_or_else(|| js_error("engine is not open"))?;
        let applied = font
            .apply_intents(FontIntentSet { intents })
            .map_err(js_error)?;
        Ok::<_, JsError>(
            applied
                .layers
                .iter()
                .map(|touched| TouchedLayer {
                    structural: touched.structural,
                    state: GlyphState::from_layer(&touched.layer),
                })
                .collect::<Vec<_>>(),
        )
    })?;
    // Values cross as plain arrays here; the TS side copies them into a Float64Array.
    serde_wasm_bindgen::to_value(&touched).map_err(js_error)
}

/// Glyph count and wasm memory, for the spike's measurements.
#[wasm_bindgen(js_name = engineStats)]
pub fn engine_stats() -> JsValue {
    let glyphs = ENGINE.with(|engine| engine.borrow().as_ref().map_or(0, Font::glyph_count));
    #[cfg(target_arch = "wasm32")]
    let pages = core::arch::wasm32::memory_size(0);
    #[cfg(not(target_arch = "wasm32"))]
    let pages = 0;
    serde_wasm_bindgen::to_value(&serde_json_stats(glyphs, pages)).unwrap_or(JsValue::NULL)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    glyphs: usize,
    wasm_memory_mb: f64,
}

fn serde_json_stats(glyphs: usize, pages: usize) -> Stats {
    Stats {
        glyphs,
        wasm_memory_mb: pages as f64 * 64.0 / 1024.0,
    }
}
