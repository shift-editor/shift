//! SPIKE: the renderer's editing engine, writing through shift-font itself.
//!
//! Holds the workspace directory (every glyph and layer identity, with empty
//! placeholder layers) plus every layer the editor has loaded, and applies
//! layer intents with `Font::apply_intents`, the same code the native
//! workspace runs. The editor publishes the returned layers as final state;
//! the native workspace replays the same intents only to persist them.
//!
//! Results cross the boundary once per edit: each touched layer's values as
//! one `Float64Array`, and its structure only when the structure changed.

use std::cell::RefCell;
use std::collections::HashMap;

use js_sys::{Array, Float64Array, Object, Reflect};
use serde::Deserialize;
use shift_font::{
    AnchorId, AnchorSeed, ComponentId, ContourId, DesignLocation, Font, FontChange, FontChangeSet,
    FontIntent, FontIntentSet, Glyph, GlyphId, GlyphLayer, LayerId, PointId, PointSeed, Source,
    SourceId, Transform,
};
use shift_wire::{state::layer_from_state, values_from_layer, GlyphStructure, PointType};
use wasm_bindgen::prelude::*;

thread_local! {
    static ENGINE: RefCell<Option<Font>> = const { RefCell::new(None) };
    /// Changesets of edits the workspace has not yet persisted, by renderer
    /// edit id, so a throwing transaction can roll them back.
    static UNPERSISTED: RefCell<HashMap<u32, Vec<FontChangeSet>>> = RefCell::new(HashMap::new());
    /// Undo history kept entry for entry with the workspace's ledger.
    static HISTORY: RefCell<History> = RefCell::new(History::default());
}

/// Matches the workspace ledger's bound.
const MAX_HISTORY_ENTRIES: usize = 100;

/// One committed renderer edit in the editor's single undo timeline.
struct HistoryEntry {
    edit_id: u32,
    /// Timeline position after this entry, for dirty tracking.
    position: u64,
    /// The edit's changesets, oldest first; `None` when part of it was not
    /// applied by this engine, so the workspace ledger holds and undoes it.
    changes: Option<Vec<FontChangeSet>>,
}

/// The editor's undo timeline. Engine entries undo here and are persisted as
/// layer states; workspace entries appear as markers, in order, so stepping
/// over one hands that step to the workspace ledger, which holds only those.
#[derive(Default)]
struct History {
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
    next_position: u64,
    /// Position of the saved document; `None` when unknown, which keeps the
    /// document dirty until the next save.
    saved: Option<u64>,
}

impl History {
    fn current_position(&self) -> u64 {
        self.undo.last().map_or(0, |entry| entry.position)
    }

    fn dirty(&self) -> bool {
        self.saved != Some(self.current_position())
    }

    /// The entry for `edit_id`, created at the top of the undo stack if new.
    /// Returns whether creating it dropped workspace entries from the redo
    /// branch, which the workspace must then discard too.
    fn entry(&mut self, edit_id: u32) -> (&mut HistoryEntry, bool) {
        let mut dropped_workspace_redo = false;
        if self
            .undo
            .last()
            .is_none_or(|entry| entry.edit_id != edit_id)
        {
            dropped_workspace_redo = self.redo.iter().any(|entry| entry.changes.is_none());
            self.redo.clear();
            self.next_position += 1;
            self.undo.push(HistoryEntry {
                edit_id,
                position: self.next_position,
                changes: Some(Vec::new()),
            });
            if self.undo.len() > MAX_HISTORY_ENTRIES {
                self.undo.remove(0);
            }
        }
        (
            self.undo.last_mut().expect("an entry was just ensured"),
            dropped_workspace_redo,
        )
    }
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

fn parse_all<T: std::str::FromStr>(values: &[String]) -> Result<Vec<T>, JsError>
where
    T::Err: std::fmt::Display,
{
    values.iter().map(|value| parse(value)).collect()
}

fn with_font<R>(body: impl FnOnce(&mut Font) -> Result<R, JsError>) -> Result<R, JsError> {
    ENGINE.with(|engine| {
        let mut engine = engine.borrow_mut();
        let font = engine
            .as_mut()
            .ok_or_else(|| js_error("engine is not open"))?;
        body(font)
    })
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
    // The history survives a rebuild: its changesets compare layers by
    // content, and loaded layers are reinstalled after a rebuild.
    ENGINE.with(|engine| *engine.borrow_mut() = Some(font));
    Ok(())
}

/// Installs a layer's authored state that did not come from this engine:
/// a load, or a change the native workspace made (undo, an agent).
#[wasm_bindgen(js_name = engineInstallLayer)]
pub fn engine_install_layer(
    layer_id: &str,
    structure: JsValue,
    values: &[f64],
) -> Result<(), JsError> {
    let structure: GlyphStructure = serde_wasm_bindgen::from_value(structure).map_err(js_error)?;
    let layer_id: LayerId = parse(layer_id)?;
    with_font(|font| {
        let source_id = font.require_layer(&layer_id).map_err(js_error)?.source_id();
        let layer = layer_from_state(layer_id, source_id, &structure, values).map_err(js_error)?;
        font.replace_glyph_layers(vec![layer]).map_err(js_error)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WirePointSeed {
    id: String,
    x: f64,
    y: f64,
    point_type: PointType,
    smooth: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireAnchorSeed {
    id: String,
    name: Option<String>,
    x: f64,
    y: f64,
}

/// The layer intents' wire payloads, as `FontIntent` in `@shift/types` carries them.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct WirePayload {
    layer_id: String,
    contour_id: Option<String>,
    before: Option<String>,
    closed: bool,
    point_id: Option<String>,
    point_ids: Vec<String>,
    points: Vec<WirePointSeed>,
    coords: Vec<f64>,
    smooth: bool,
    matrix: Vec<f64>,
    width: f64,
    anchors: Vec<WireAnchorSeed>,
    anchor_ids: Vec<String>,
    names: Vec<String>,
    component_ids: Vec<String>,
    transforms: Vec<f64>,
}

/// A wire `FontIntent`: its payload sits under the field named by `kind`.
///
/// Each payload is a named field rather than a flattened map: flattening
/// buffers numbers untyped, which turns `-0` into the integer `0`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireIntent {
    kind: String,
    add_contour: Option<WirePayload>,
    add_points: Option<WirePayload>,
    set_contour_closed: Option<WirePayload>,
    move_points: Option<WirePayload>,
    set_point_smooth: Option<WirePayload>,
    remove_points: Option<WirePayload>,
    reverse_contour: Option<WirePayload>,
    set_contour_start: Option<WirePayload>,
    transform_layer: Option<WirePayload>,
    set_x_advance: Option<WirePayload>,
    add_anchors: Option<WirePayload>,
    move_anchors: Option<WirePayload>,
    rename_anchors: Option<WirePayload>,
    remove_anchors: Option<WirePayload>,
    set_component_transforms: Option<WirePayload>,
}

impl WireIntent {
    fn into_payload(self) -> Result<(String, WirePayload), JsError> {
        let payload = match self.kind.as_str() {
            "addContour" => self.add_contour,
            "addPoints" => self.add_points,
            "setContourClosed" => self.set_contour_closed,
            "movePoints" => self.move_points,
            "setPointSmooth" => self.set_point_smooth,
            "removePoints" => self.remove_points,
            "reverseContour" => self.reverse_contour,
            "setContourStart" => self.set_contour_start,
            "transformLayer" => self.transform_layer,
            "setXAdvance" => self.set_x_advance,
            "addAnchors" => self.add_anchors,
            "moveAnchors" => self.move_anchors,
            "renameAnchors" => self.rename_anchors,
            "removeAnchors" => self.remove_anchors,
            "setComponentTransforms" => self.set_component_transforms,
            kind => return Err(js_error(format!("the engine does not route {kind}"))),
        };
        let payload = payload.ok_or_else(|| js_error(format!("missing {} payload", self.kind)))?;
        Ok((self.kind, payload))
    }
}

fn required(value: Option<String>, what: &str) -> Result<String, JsError> {
    value.ok_or_else(|| js_error(format!("missing {what}")))
}

fn font_intent(wire: WireIntent) -> Result<FontIntent, JsError> {
    let (kind, payload) = wire.into_payload()?;
    let layer_id: LayerId = parse(&payload.layer_id)?;
    let contour = |payload: &WirePayload| -> Result<ContourId, JsError> {
        parse(&required(payload.contour_id.clone(), "contourId")?)
    };
    Ok(match kind.as_str() {
        "addContour" => FontIntent::AddContour {
            contour_id: contour(&payload)?,
            closed: payload.closed,
            layer_id,
        },
        "addPoints" => FontIntent::AddPoints {
            contour_id: payload.contour_id.as_deref().map(parse).transpose()?,
            before: payload.before.as_deref().map(parse).transpose()?,
            points: payload
                .points
                .iter()
                .map(|seed| {
                    Ok(PointSeed {
                        id: parse(&seed.id)?,
                        x: seed.x,
                        y: seed.y,
                        point_type: seed.point_type.into(),
                        smooth: seed.smooth,
                    })
                })
                .collect::<Result<_, JsError>>()?,
            layer_id,
        },
        "setContourClosed" => FontIntent::SetContourClosed {
            contour_id: contour(&payload)?,
            closed: payload.closed,
            layer_id,
        },
        "movePoints" => FontIntent::MovePoints {
            point_ids: parse_all::<PointId>(&payload.point_ids)?,
            coords: payload.coords,
            layer_id,
        },
        "setPointSmooth" => FontIntent::SetPointSmooth {
            point_id: parse(&required(payload.point_id, "pointId")?)?,
            smooth: payload.smooth,
            layer_id,
        },
        "removePoints" => FontIntent::RemovePoints {
            point_ids: parse_all::<PointId>(&payload.point_ids)?,
            layer_id,
        },
        "reverseContour" => FontIntent::ReverseContour {
            contour_id: contour(&payload)?,
            layer_id,
        },
        "setContourStart" => FontIntent::SetContourStart {
            contour_id: contour(&payload)?,
            point_id: parse(&required(payload.point_id, "pointId")?)?,
            layer_id,
        },
        "transformLayer" => {
            let [xx, xy, yx, yy, dx, dy] = <[f64; 6]>::try_from(payload.matrix.as_slice())
                .map_err(|_| js_error("transformLayer needs six matrix values"))?;
            FontIntent::TransformLayer {
                transform: Transform {
                    xx,
                    xy,
                    yx,
                    yy,
                    dx,
                    dy,
                },
                layer_id,
            }
        }
        "setXAdvance" => FontIntent::SetXAdvance {
            width: payload.width,
            layer_id,
        },
        "addAnchors" => FontIntent::AddAnchors {
            anchors: payload
                .anchors
                .iter()
                .map(|seed| {
                    Ok(AnchorSeed {
                        id: parse(&seed.id)?,
                        name: seed.name.clone(),
                        x: seed.x,
                        y: seed.y,
                    })
                })
                .collect::<Result<_, JsError>>()?,
            layer_id,
        },
        "moveAnchors" => FontIntent::MoveAnchors {
            anchor_ids: parse_all::<AnchorId>(&payload.anchor_ids)?,
            coords: payload.coords,
            layer_id,
        },
        "renameAnchors" => FontIntent::RenameAnchors {
            anchor_ids: parse_all::<AnchorId>(&payload.anchor_ids)?,
            names: payload.names,
            layer_id,
        },
        "removeAnchors" => FontIntent::RemoveAnchors {
            anchor_ids: parse_all::<AnchorId>(&payload.anchor_ids)?,
            layer_id,
        },
        "setComponentTransforms" => FontIntent::SetComponentTransforms {
            component_ids: parse_all::<ComponentId>(&payload.component_ids)?,
            transforms: payload.transforms,
            layer_id,
        },
        kind => return Err(js_error(format!("the engine does not route {kind}"))),
    })
}

fn set(object: &Object, key: &str, value: &JsValue) -> Result<(), JsError> {
    Reflect::set(object, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| js_error(format!("could not set {key}")))
}

/// One touched layer as `{ layerId, structure?, values: Float64Array }`.
fn layer_result(layer: &GlyphLayer, structural: bool) -> Result<Object, JsError> {
    let result = Object::new();
    set(&result, "layerId", &JsValue::from_str(layer.id().as_str()))?;
    if structural {
        let structure =
            serde_wasm_bindgen::to_value(&GlyphStructure::from(layer)).map_err(js_error)?;
        set(&result, "structure", &structure)?;
    }
    let values = values_from_layer(layer);
    set(
        &result,
        "values",
        &Float64Array::from(values.as_slice()).into(),
    )?;
    Ok(result)
}

/// Applies layer intents through `Font::apply_intents` as part of edit `edit_id`.
///
/// Returns every touched layer, including composites that followed a moved
/// anchor. The changeset is kept until [`engine_persisted`] or
/// [`engine_rollback`] settles the edit.
#[wasm_bindgen(js_name = engineApply)]
pub fn engine_apply(edit_id: u32, intents: JsValue) -> Result<Array, JsError> {
    let wire: Vec<WireIntent> = serde_wasm_bindgen::from_value(intents).map_err(js_error)?;
    let intents = wire
        .into_iter()
        .map(font_intent)
        .collect::<Result<Vec<_>, _>>()?;
    with_font(|font| {
        let applied = font
            .apply_intents(FontIntentSet { intents })
            .map_err(js_error)?;
        let result = Array::new();
        for touched in &applied.layers {
            result.push(&layer_result(&touched.layer, touched.structural)?.into());
        }
        HISTORY.with(|history| {
            let mut history = history.borrow_mut();
            if let Some(changes) = &mut history.entry(edit_id).0.changes {
                changes.push(applied.changes.clone());
            }
        });
        UNPERSISTED.with(|edits| {
            edits
                .borrow_mut()
                .entry(edit_id)
                .or_default()
                .push(applied.changes);
        });
        Ok(result)
    })
}

/// Forgets an edit's changesets once the workspace has persisted it.
#[wasm_bindgen(js_name = enginePersisted)]
pub fn engine_persisted(edit_id: u32) {
    UNPERSISTED.with(|edits| edits.borrow_mut().remove(&edit_id));
}

/// Reverts every change of edit `edit_id`, newest first, and returns the
/// layers it restored, structure included.
#[wasm_bindgen(js_name = engineRollback)]
pub fn engine_rollback(edit_id: u32) -> Result<Array, JsError> {
    let changes = UNPERSISTED
        .with(|edits| edits.borrow_mut().remove(&edit_id))
        .unwrap_or_default();
    // The transaction never reached the workspace, so its entry leaves the history too.
    HISTORY.with(|history| {
        let mut history = history.borrow_mut();
        if history
            .undo
            .last()
            .is_some_and(|entry| entry.edit_id == edit_id)
        {
            history.undo.pop();
        }
    });
    with_font(|font| {
        let mut layer_ids = Vec::new();
        for change_set in changes.iter().rev() {
            font.apply_change_set(&change_set.inverted())
                .map_err(js_error)?;
            for change in &change_set.changes {
                if let FontChange::Layer { layer, .. } = change {
                    let id = layer
                        .before
                        .as_ref()
                        .or(layer.after.as_ref())
                        .map(|layer| layer.id());
                    if let Some(id) = id.filter(|id| !layer_ids.contains(id)) {
                        layer_ids.push(id);
                    }
                }
            }
        }
        let result = Array::new();
        for layer_id in &layer_ids {
            if let Some(layer) = font.layer(layer_id) {
                result.push(&layer_result(layer, true)?.into());
            }
        }
        Ok(result)
    })
}

/// Records committed renderer edit `edit_id` in the timeline;
/// `engine_applied` is false when it carries intents this engine did not
/// apply, so the workspace ledger holds and undoes it.
///
/// Returns whether workspace entries left the redo branch, which the
/// workspace must then discard too.
#[wasm_bindgen(js_name = engineRecordEdit)]
pub fn engine_record_edit(edit_id: u32, engine_applied: bool) -> bool {
    HISTORY.with(|history| {
        let mut history = history.borrow_mut();
        let (entry, dropped_workspace_redo) = history.entry(edit_id);
        if !engine_applied {
            entry.changes = None;
        }
        dropped_workspace_redo
    })
}

/// Whether the document differs from its last save, by timeline position.
#[wasm_bindgen(js_name = engineDirty)]
pub fn engine_dirty() -> bool {
    HISTORY.with(|history| history.borrow().dirty())
}

/// Marks the current timeline position as the saved document.
#[wasm_bindgen(js_name = engineMarkSaved)]
pub fn engine_mark_saved() {
    HISTORY.with(|history| {
        let mut history = history.borrow_mut();
        history.saved = Some(history.current_position());
    });
}

/// The layers a history step changed, read after the step applied.
fn changed_layers(font: &Font, changes: &[FontChangeSet]) -> Result<Array, JsError> {
    let mut layer_ids = Vec::new();
    for change_set in changes {
        for change in &change_set.changes {
            if let FontChange::Layer { layer, .. } = change {
                let id = layer
                    .before
                    .as_ref()
                    .or(layer.after.as_ref())
                    .map(|layer| layer.id());
                if let Some(id) = id.filter(|id| !layer_ids.contains(id)) {
                    layer_ids.push(id);
                }
            }
        }
    }
    let result = Array::new();
    for layer_id in &layer_ids {
        if let Some(layer) = font.layer(layer_id) {
            result.push(&layer_result(layer, true)?.into());
        }
    }
    Ok(result)
}

/// Steps the timeline one entry in `direction`, synchronously.
///
/// Returns `{ kind: "engine", layers }` when this engine applied the entry
/// (the layers to publish and persist), `{ kind: "workspace" }` when the
/// workspace ledger must step instead (the marker moves across either way),
/// or `null` when there is nothing to step or the history no longer applies.
fn step_history(undo: bool) -> Result<JsValue, JsError> {
    let entry = HISTORY.with(|history| {
        let mut history = history.borrow_mut();
        if undo {
            history.undo.pop()
        } else {
            history.redo.pop()
        }
    });
    let Some(entry) = entry else {
        return Ok(JsValue::NULL);
    };
    let finish = |entry: HistoryEntry| {
        HISTORY.with(|history| {
            let mut history = history.borrow_mut();
            if undo {
                history.redo.push(entry)
            } else {
                history.undo.push(entry)
            }
        });
    };
    let result = Object::new();
    let Some(changes) = &entry.changes else {
        finish(entry);
        set(&result, "kind", &JsValue::from_str("workspace"))?;
        return Ok(result.into());
    };

    let stepped = with_font(|font| {
        if undo {
            for change_set in changes.iter().rev() {
                font.apply_change_set(&change_set.inverted())
                    .map_err(js_error)?;
            }
        } else {
            for change_set in changes {
                font.apply_change_set(change_set).map_err(js_error)?;
            }
        }
        changed_layers(font, changes)
    });
    match stepped {
        Ok(layers) => {
            finish(entry);
            set(&result, "kind", &JsValue::from_str("engine"))?;
            set(&result, "layers", &layers.into())?;
            Ok(result.into())
        }
        Err(_) => {
            // The engine's copy no longer matches its history; drop the history.
            HISTORY.with(|history| *history.borrow_mut() = History::default());
            Ok(JsValue::NULL)
        }
    }
}

/// Drops the redo branch, as the workspace ledger's `discard_redo` does.
#[wasm_bindgen(js_name = engineDiscardRedo)]
pub fn engine_discard_redo() {
    HISTORY.with(|history| history.borrow_mut().redo.clear());
}

/// Undoes the latest edit synchronously when this engine applied it.
#[wasm_bindgen(js_name = engineUndo)]
pub fn engine_undo() -> Result<JsValue, JsError> {
    step_history(true)
}

/// Redoes the latest undone edit synchronously when this engine applied it.
#[wasm_bindgen(js_name = engineRedo)]
pub fn engine_redo() -> Result<JsValue, JsError> {
    step_history(false)
}

/// Glyph count and wasm memory, for the spike's measurements.
#[wasm_bindgen(js_name = engineStats)]
pub fn engine_stats() -> Result<Object, JsError> {
    let glyphs = ENGINE.with(|engine| engine.borrow().as_ref().map_or(0, Font::glyph_count));
    #[cfg(target_arch = "wasm32")]
    let pages = core::arch::wasm32::memory_size(0);
    #[cfg(not(target_arch = "wasm32"))]
    let pages = 0;
    let stats = Object::new();
    set(&stats, "glyphs", &JsValue::from(glyphs as u32))?;
    set(
        &stats,
        "wasmMemoryMb",
        &JsValue::from(pages as f64 * 64.0 / 1024.0),
    )?;
    Ok(stats)
}
