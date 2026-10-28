//! The editing engine: an [`EngineSession`] over the open font that applies
//! the editor's intents synchronously, in the frame they are made.
//!
//! Layers load on demand through an [`EngineLayerSource`] the editor passes
//! in, which reads the store synchronously. Intents arrive in the same shape
//! the native workspace takes (`shift_wire::intents`), and each touched layer
//! comes back in the same shape as the workspace's echo.

use std::cell::RefCell;

use js_sys::{Array, Float64Array, Object, Reflect, Uint8Array};
use serde::Serialize;
use shift_engine::{ApplyError, EditHistory, EngineSession, LayerSource};
use shift_font::{
    AppliedIntents, Contour, Font, FontChangeImpact, FontIntent, FontIntentSet, GlyphId,
    GlyphLayer, LayerId, SetPositions, TouchedLayer,
};
use shift_wire::replacement::FontReplacement;
use shift_wire::{AnchorData, ComponentData, ContourData, intents};
use wasm_bindgen::prelude::*;

use crate::engine_reads::InternedIds;

#[wasm_bindgen(typescript_custom_section)]
const ENGINE_TYPES: &str = r#"
import type {
  ContourData,
  ContourId,
  FontIntent,
  FontReplacement,
  GlyphId,
  GlyphStructure,
  KerningGroupId,
  LayerId,
} from "@shift/types";

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

/** What one edit did: the layers it touched and the font-level records it changed. */
export interface EngineEdit {
  layers: EngineLayer[];
  /**
   * Each font-level collection the edit changed, whole, as the workspace's
   * echo carries it; absent when it changed none. Glyph records never come
   * from the engine: they need the store's component references and glyph
   * categories.
   */
  next?: FontReplacement;
  /** For an undo or redo: its change set, as named MessagePack, to persist. */
  changeSet?: Uint8Array;
  /** For an undo or redo: whether it left the font as last saved. */
  matchesSaved?: boolean;
}

/**
 * What applying intents within the open edit did, without the font-level
 * records an `EngineEdit` carries: the layers they touched, and whether they
 * changed what the engine's kerning and source-metric reads return.
 */
export interface EngineStage {
  layers: EngineLayer[];
  kerning: boolean;
  sourceMetrics: boolean;
}

/** A contour an edit kept as it was: the one with this id in the structure the edit started from. */
export interface KeptContour {
  id: ContourId;
  kept: true;
}

/** A layer's structure after a structural edit; the contours it kept come by id alone. */
export interface EngineStructure extends Omit<GlyphStructure, "contours"> {
  contours: (ContourData | KeptContour)[];
}

/**
 * One layer an edit touched: its values, and its structure when the edit
 * changed it.
 */
export interface EngineLayer {
  layerId: LayerId;
  /**
   * The layer's structure, or null when the edit changed only its values: the
   * structure is then the one the edit started from. Contours the edit kept
   * come by id alone, as they are in that structure.
   */
  structure: EngineStructure | null;
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

/// An open session, the source it reads from, its undo history, the
/// session as it stood when the open edit began, to go back to if it is
/// cancelled, and the ids the editor's reads name by number.
pub(crate) struct Engine {
    pub(crate) session: EngineSession,
    source: EngineLayerSource,
    history: EditHistory,
    before_edit: Option<EngineSession>,
    pub(crate) ids: InternedIds,
}

impl Engine {
    /// Loads `layer_ids` that are still placeholders, from the source.
    pub(crate) fn load_layers(&mut self, layer_ids: Vec<LayerId>) -> Result<(), JsError> {
        self.session
            .load_layers(&mut HostLayers(&self.source), layer_ids)
            .map_err(|error| JsError::new(&error.to_string()))
    }
}

thread_local! {
    static ENGINES: RefCell<Vec<Option<Engine>>> = const { RefCell::new(Vec::new()) };
}

/// Runs `edit` on the engine at `handle`.
pub(crate) fn with_engine<T>(
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
        engines.push(Some(Engine {
            session,
            source,
            history: EditHistory::default(),
            before_edit: None,
            ids: InternedIds::default(),
        }));
        Ok(handle)
    })
}

/// Opens an edit: the applies until [`engine_end_edit`] become one undo step
/// and one change set. Remembers the session as it stands, for
/// [`engine_cancel_edit`]; sessions share structure, so this copies nothing.
///
/// # Errors
///
/// Fails on an unknown handle.
#[wasm_bindgen(js_name = engineBeginEdit)]
pub fn engine_begin_edit(handle: u32) -> Result<(), JsError> {
    with_engine(handle, |engine| {
        engine.before_edit = Some(engine.session.clone());
        engine.history.begin();
        Ok(())
    })
}

/// Applies `intents`, in the shape the workspace takes, as part of the open
/// edit: loads what they read, applies them, and returns every layer they
/// touched and the font-level records they changed.
///
/// # Errors
///
/// Fails when no edit is open, when an intent does not decode, when the source
/// fails, or when the intents are invalid; the session is then as loading left
/// it.
#[wasm_bindgen(js_name = engineApply, unchecked_return_type = "EngineEdit")]
pub fn engine_apply(
    handle: u32,
    #[wasm_bindgen(unchecked_param_type = "FontIntent[]")] intents: JsValue,
) -> Result<JsValue, JsError> {
    let intents = intent_set(&intents)?;
    with_engine(handle, |engine| {
        if !engine.history.is_open() {
            return Err(JsError::new("no edit is open; begin one first"));
        }
        let before = engine.session.font().clone();
        let applied = engine
            .session
            .apply(&mut HostLayers(&engine.source), &intents)
            .map_err(apply_error)?;
        let edit = edit_object(engine.session.font(), &before, &applied)?;
        engine.history.record(applied.changes);
        Ok(edit.into())
    })
}

/// Puts the session back where the open edit began and keeps the edit open,
/// so the applies that follow replace what it applied so far: a gesture
/// re-applies its latest intents each frame.
///
/// # Errors
///
/// Fails on an unknown handle, or when no edit is open.
#[wasm_bindgen(js_name = engineRewindEdit)]
pub fn engine_rewind_edit(handle: u32) -> Result<(), JsError> {
    with_engine(handle, |engine| {
        let before = engine
            .before_edit
            .clone()
            .ok_or_else(|| JsError::new("no edit is open; begin one first"))?;
        engine.session = before;
        engine.history.begin();
        Ok(())
    })
}

/// Applies `intents` as part of the open edit, as [`engine_apply`] does, but
/// returns only the layers they touched and which reads they changed, not the
/// font-level records: a gesture's frame, whose records are built once when
/// it commits.
///
/// # Errors
///
/// As [`engine_apply`].
#[wasm_bindgen(js_name = engineStage, unchecked_return_type = "EngineStage")]
pub fn engine_stage(
    handle: u32,
    #[wasm_bindgen(unchecked_param_type = "FontIntent[]")] intents: JsValue,
) -> Result<JsValue, JsError> {
    let intents = intent_set(&intents)?;
    with_engine(handle, |engine| {
        if !engine.history.is_open() {
            return Err(JsError::new("no edit is open; begin one first"));
        }
        let before = engine.session.font().clone();
        let applied = engine
            .session
            .apply(&mut HostLayers(&engine.source), &intents)
            .map_err(apply_error)?;
        let layers = engine_layers(&before, &applied.layers)?;
        let impact = applied.changes.impact();
        engine.history.record(applied.changes);

        let stage = Object::new();
        set(&stage, "layers", &layers)?;
        set(
            &stage,
            "kerning",
            &JsValue::from_bool(impact.intersects(FontChangeImpact::KERNING)),
        )?;
        set(
            &stage,
            "sourceMetrics",
            &JsValue::from_bool(impact.intersects(FontChangeImpact::SOURCE_METRICS)),
        )?;
        Ok(stage.into())
    })
}

/// Closes the open edit as one undo step and returns its change set, as named
/// MessagePack, to persist; `undefined` when it changed nothing.
///
/// # Errors
///
/// Fails on an unknown handle, or when the edit's changes cannot be coalesced
/// or encoded.
#[wasm_bindgen(js_name = engineEndEdit)]
pub fn engine_end_edit(handle: u32) -> Result<Option<Uint8Array>, JsError> {
    with_engine(handle, |engine| {
        engine.before_edit = None;
        let Some(change_set) = engine.history.end(engine.session.font())? else {
            return Ok(None);
        };
        Ok(Some(Uint8Array::from(
            &rmp_serde::to_vec_named(&change_set.compact())?[..],
        )))
    })
}

/// Drops the open edit: the session goes back to where the edit began.
///
/// # Errors
///
/// Fails on an unknown handle.
#[wasm_bindgen(js_name = engineCancelEdit)]
pub fn engine_cancel_edit(handle: u32) -> Result<(), JsError> {
    with_engine(handle, |engine| {
        if let Some(before) = engine.before_edit.take() {
            engine.session = before;
        }
        engine.history.cancel();
        Ok(())
    })
}

/// Takes back the latest edit and returns what it did, with the change set
/// to persist; `undefined` when there is nothing to undo.
///
/// # Errors
///
/// Fails when the source fails or the inverse no longer applies; the edit
/// stays undoable.
#[wasm_bindgen(js_name = engineUndo, unchecked_return_type = "EngineEdit | undefined")]
pub fn engine_undo(handle: u32) -> Result<JsValue, JsError> {
    with_engine(handle, |engine| {
        let before = engine.session.font().clone();
        let undone = engine
            .history
            .undo(&mut engine.session, &mut HostLayers(&engine.source))
            .map_err(apply_error)?;
        replayed(engine, &before, undone)
    })
}

/// Makes the latest undone edit again and returns what it did, with the change
/// set to persist; `undefined` when there is nothing to redo.
///
/// # Errors
///
/// As [`engine_undo`].
#[wasm_bindgen(js_name = engineRedo, unchecked_return_type = "EngineEdit | undefined")]
pub fn engine_redo(handle: u32) -> Result<JsValue, JsError> {
    with_engine(handle, |engine| {
        let before = engine.session.font().clone();
        let redone = engine
            .history
            .redo(&mut engine.session, &mut HostLayers(&engine.source))
            .map_err(apply_error)?;
        replayed(engine, &before, redone)
    })
}

/// Forgets every undone edit.
///
/// # Errors
///
/// Fails on an unknown handle.
#[wasm_bindgen(js_name = engineDiscardRedo)]
pub fn engine_discard_redo(handle: u32) -> Result<(), JsError> {
    with_engine(handle, |engine| {
        engine.history.discard_redo();
        Ok(())
    })
}

/// An undo or redo as an `EngineEdit` carrying its change set and whether it
/// left the font as last saved, or `undefined`.
fn replayed(
    engine: &Engine,
    before: &Font,
    applied: Option<AppliedIntents>,
) -> Result<JsValue, JsError> {
    let Some(applied) = applied else {
        return Ok(JsValue::UNDEFINED);
    };
    let edit = edit_object(engine.session.font(), before, &applied)?;
    let change_set = rmp_serde::to_vec_named(&applied.changes.compact())?;
    set(&edit, "changeSet", &Uint8Array::from(&change_set[..]))?;
    set(
        &edit,
        "matchesSaved",
        &JsValue::from_bool(engine.history.matches_saved()),
    )?;
    Ok(edit.into())
}

/// Records that the font, where the history now stands, is the saved
/// document: after a save, or on opening one with no unsaved edits.
///
/// # Errors
///
/// Fails on an unknown handle.
#[wasm_bindgen(js_name = engineMarkSaved)]
pub fn engine_mark_saved(handle: u32) -> Result<(), JsError> {
    with_engine(handle, |engine| {
        engine.history.mark_saved();
        Ok(())
    })
}

/// What an edit did as an `EngineEdit`: its touched layers and the font-level
/// records it changed. Glyph records are left to the workspace's echo.
fn edit_object(font: &Font, before: &Font, applied: &AppliedIntents) -> Result<Object, JsError> {
    let layers = engine_layers(before, &applied.layers)?;
    let edit = Object::new();
    set(&edit, "layers", &layers)?;
    let impact = applied
        .changes
        .impact()
        .difference(FontChangeImpact::GLYPHS);
    if let Some(next) = FontReplacement::changed_by(font, impact)? {
        let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
        set(&edit, "next", &next.serialize(&serializer)?)?;
    }
    Ok(edit)
}

/// Returns every layer applying `intents` would touch, as they would be,
/// without keeping the edit: a preview for a gesture under way. What the
/// intents read stays loaded.
///
/// # Errors
///
/// As [`engine_apply`].
#[wasm_bindgen(js_name = enginePreview, unchecked_return_type = "EngineLayer[]")]
pub fn engine_preview(
    handle: u32,
    #[wasm_bindgen(unchecked_param_type = "FontIntent[]")] intents: JsValue,
) -> Result<Array, JsError> {
    let set = intent_set(&intents)?;
    with_engine(handle, |engine| {
        let previewed = engine
            .session
            .preview(&mut HostLayers(&engine.source), &set)
            .map_err(apply_error)?;
        // A preview keeps nothing, so the session's font is what it started from.
        engine_layers(engine.session.font(), &previewed.layers)
    })
}

/// `intents`, in the shape the workspace takes, as one set.
fn intent_set(intents: &JsValue) -> Result<FontIntentSet, JsError> {
    let intents = Array::from(intents)
        .iter()
        .map(|intent| {
            if let Some(intent) = positions_intent(&intent)? {
                return Ok(intent);
            }
            let wire: intents::FontIntent = serde_wasm_bindgen::from_value(plain_arrays(&intent)?)?;
            Ok(FontIntent::try_from(wire)?)
        })
        .collect::<Result<_, JsError>>()?;
    Ok(FontIntentSet { intents })
}

/// A `setPositions` intent read straight from its object, or `None` for any
/// other kind. Its positions, a hundred thousand numbers on a large glyph,
/// cross as one copied block; through serde they were read one at a time,
/// which cost ten times the edit.
fn positions_intent(intent: &JsValue) -> Result<Option<FontIntent>, JsError> {
    let field = |object: &JsValue, key: &str| Reflect::get(object, &JsValue::from_str(key)).ok();
    if field(intent, "kind")
        .and_then(|kind| kind.as_string())
        .as_deref()
        != Some("setPositions")
    {
        return Ok(None);
    }
    let payload =
        field(intent, "setPositions").ok_or_else(|| JsError::new("setPositions has no payload"))?;
    let layer_id = field(&payload, "layerId")
        .and_then(|id| id.as_string())
        .ok_or_else(|| JsError::new("setPositions has no layer id"))?;
    let positions = field(&payload, "positions")
        .ok_or_else(|| JsError::new("setPositions has no positions"))?;
    Ok(Some(
        SetPositions {
            layer_id: intents::parse::<LayerId>(&layer_id)?,
            positions: Float64Array::new(&positions).to_vec(),
        }
        .into(),
    ))
}

fn apply_error(error: ApplyError<HostError>) -> JsError {
    match error {
        ApplyError::Load(error) => JsError::new(&error.to_string()),
        ApplyError::Engine(error) => JsError::new(&error.to_string()),
    }
}

/// Loads every layer of `glyph_ids` and of the glyphs their components use,
/// ahead of the edits that will read them.
///
/// # Errors
///
/// Fails on an unknown handle or glyph id, or when the source fails.
#[wasm_bindgen(js_name = enginePreload)]
pub fn engine_preload(handle: u32, glyph_ids: Vec<String>) -> Result<(), JsError> {
    let glyph_ids = intents::parse_id_list::<GlyphId>(&glyph_ids)?;
    with_engine(handle, |engine| {
        engine
            .session
            .load_glyph_closure(&mut HostLayers(&engine.source), glyph_ids)
            .map_err(|error| JsError::new(&error.to_string()))
    })
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

/// `intent` with its payload's typed-array fields copied into plain arrays.
///
/// The wire intent is internally tagged, so serde reads its payload through
/// `deserialize_any`, which serde-wasm-bindgen cannot take a typed array to.
/// The caller's intent stays as it was: the workspace reads it next.
fn plain_arrays(intent: &JsValue) -> Result<JsValue, JsError> {
    let copy = Object::assign(&Object::new(), &Object::from(intent.clone()));
    for entry in Object::entries(&copy).iter() {
        let entry = Array::from(&entry);
        let Some(payload) = entry.get(1).dyn_ref::<Object>().cloned() else {
            continue;
        };
        let payload = Object::assign(&Object::new(), &payload);
        for field in Object::entries(&payload).iter() {
            let field = Array::from(&field);
            if let Some(values) = field.get(1).dyn_ref::<Float64Array>() {
                set_value(&payload, &field.get(0), &Array::from(values))?;
            }
        }
        set_value(&copy, &entry.get(0), &payload)?;
    }
    Ok(copy.into())
}

/// Sets `key` on `object`, which fails only on a frozen or proxied object.
fn set_value(object: &Object, key: &JsValue, value: &JsValue) -> Result<(), JsError> {
    Reflect::set(object, key, value)
        .map(|_| ())
        .map_err(|_| JsError::new(&format!("cannot set {key:?}")))
}

/// Each touched layer as an `EngineLayer` object, against the font as it was
/// before the edit.
fn engine_layers(before: &Font, touched: &[TouchedLayer]) -> Result<Array, JsError> {
    touched
        .iter()
        .map(|touched| engine_layer(before, touched))
        .collect()
}

/// One touched layer as an `EngineLayer` object. A layer whose structure the
/// edit left alone crosses as its values only, and a structural edit sends in
/// full only the contours it changed: building a large glyph's structure as
/// objects cost more than the edit.
fn engine_layer(before: &Font, touched: &TouchedLayer) -> Result<JsValue, JsError> {
    let source = &touched.layer;
    let layer = Object::new();
    set(&layer, "layerId", &JsValue::from_str(source.id().as_str()))?;
    let structure = if touched.structural {
        EditedStructure::new(before.layer(source.id()), source)
            .serialize(&serde_wasm_bindgen::Serializer::new())?
    } else {
        JsValue::NULL
    };
    set(&layer, "structure", &structure)?;
    let values = shift_wire::values_from_layer(source);
    set(&layer, "values", &Float64Array::from(&values[..]))?;
    set(
        &layer,
        "structural",
        &JsValue::from_bool(touched.structural),
    )?;
    Ok(layer.into())
}

/// A layer's structure after a structural edit, each contour the edit kept
/// as it was sent by id alone.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditedStructure {
    contours: Vec<EditedContour>,
    anchors: Vec<AnchorData>,
    components: Vec<ComponentData>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum EditedContour {
    Changed(ContourData),
    /// The contour with this id in the structure the edit started from.
    Kept {
        id: String,
        kept: bool,
    },
}

impl EditedStructure {
    fn new(before: Option<&GlyphLayer>, after: &GlyphLayer) -> Self {
        let contours = after
            .contours_iter()
            .map(|contour| {
                let kept = before
                    .and_then(|layer| layer.contour(&contour.id()))
                    .is_some_and(|previous| same_structure(previous, contour));
                if kept {
                    EditedContour::Kept {
                        id: contour.id().to_string(),
                        kept: true,
                    }
                } else {
                    EditedContour::Changed(ContourData::from(contour))
                }
            })
            .collect();
        Self {
            contours,
            anchors: after.anchors_iter().map(AnchorData::from).collect(),
            components: after.components_iter().map(ComponentData::from).collect(),
        }
    }
}

/// Whether two contours have the same points, types, smoothness and closure,
/// whatever their positions.
fn same_structure(left: &Contour, right: &Contour) -> bool {
    left.is_closed() == right.is_closed()
        && left.points().len() == right.points().len()
        && left.points().iter().zip(right.points()).all(|(a, b)| {
            a.id() == b.id() && a.point_type() == b.point_type() && a.is_smooth() == b.is_smooth()
        })
}

fn set(object: &Object, key: &str, value: &JsValue) -> Result<(), JsError> {
    set_value(object, &JsValue::from_str(key), value)
}
