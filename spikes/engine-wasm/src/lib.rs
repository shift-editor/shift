//! Spike 6 probe: decode a native snapshot into the engine and edit it.
use std::cell::RefCell;

use shift_font::{Font, FontIntent, FontIntentSet, LayerId, PointId};
use wasm_bindgen::prelude::*;

thread_local! {
    static FONT: RefCell<Option<Font>> = const { RefCell::new(None) };
    static TARGET: RefCell<Option<(LayerId, PointId)>> = const { RefCell::new(None) };
}

/// Opens the engine from a MessagePack snapshot; returns the glyph count.
#[wasm_bindgen]
pub fn open_snapshot(bytes: &[u8]) -> Result<u32, JsError> {
    let font: Font = rmp_serde::from_slice(bytes).map_err(|error| JsError::new(&error.to_string()))?;
    let target = font.glyphs().flat_map(|glyph| glyph.layers().values()).find_map(|layer| {
        let point = layer.contours_iter().next()?.points().first()?.id();
        Some((layer.id(), point))
    });
    let count = font.glyph_count() as u32;
    FONT.with(|cell| *cell.borrow_mut() = Some(font));
    TARGET.with(|cell| *cell.borrow_mut() = target);
    Ok(count)
}

/// Moves one point through `apply_intents`, the engine's edit path.
#[wasm_bindgen]
pub fn move_point(x: f64) -> Result<(), JsError> {
    let (layer_id, point_id) = TARGET
        .with(|cell| cell.borrow().clone())
        .ok_or_else(|| JsError::new("no loaded point"))?;
    FONT.with(|cell| {
        let mut font = cell.borrow_mut();
        let font = font.as_mut().ok_or_else(|| JsError::new("not open"))?;
        font.apply_intents(FontIntentSet {
            intents: vec![FontIntent::MovePoints { layer_id, point_ids: vec![point_id], coords: vec![x, 0.0] }],
        })
        .map(|_| ())
        .map_err(|error| JsError::new(&error.to_string()))
    })
}

#[wasm_bindgen]
pub fn memory_mb() -> f64 {
    core::arch::wasm32::memory_size(0) as f64 * 64.0 / 1024.0
}
