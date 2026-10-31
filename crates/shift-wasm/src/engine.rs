//! The editing engine: an [`EngineSession`] over the open font that applies
//! the editor's intents synchronously, in the frame they are made.
//!
//! Layers load on demand from the store, asked through shift-engine's
//! [`StoreReader`] request protocol: the session encodes each request and
//! calls the one function the editor passes in, which forwards it unchanged
//! to the preload's native reader and returns its reply. Intents arrive as
//! shift-font's own, packed ([`crate::engine_edits`]), and each touched
//! layer comes back in the same shape as the workspace's echo.

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Float64Array, Function, Object, Reflect, Uint8Array};
use pack::{CarryingNames, Packed};
use serde::Serialize;
use shift_engine::{
    ApplyError, EditHistory, EngineSession, LayerSource, RecordCache, RecordSource, StoreReadError,
    StoreReaderClient,
};
use shift_font::{
    AppliedIntents, Contour, Font, FontChangeImpact, FontIntent, FontIntentSet, GlyphDataCategory,
    GlyphId, GlyphLayer, LayerId, NamedGlyph, TouchedLayer,
};
use shift_wire::replacement::FontReplacement;
use shift_wire::{AnchorData, ComponentData, ContourData, values};
use wasm_bindgen::prelude::*;

use crate::engine_reads::{FontVariation, InternedIds};
use crate::shaping::TextShaping;

#[wasm_bindgen(typescript_custom_section)]
const ENGINE_TYPES: &str = r#"
import type {
  ContourData,
  ContourId,
  GlyphId,
  GlyphStructure,
  KerningGroupId,
  LayerId,
} from "@shift/types";

/**
 * Sends one request of shift-engine's `StoreReader` protocol, encoded by the
 * engine, to the store's reader unchanged, and returns the reader's reply. The
 * engine calls it within an edit, synchronously; it must not call back into
 * the engine.
 */
export type StoreRequest = (
  method: number,
  numbers: Float64Array,
  blobs: Uint8Array[],
) => StoreReply;

/** A `StoreReader` reply, as the native reader returns it. */
export interface StoreReply {
  numbers: Float64Array;
  blobs: Uint8Array[];
}

/**
 * What one edit did: the layers it touched. The font-level records it changed
 * cross packed, through `EngineEdits.replacement`.
 */
export interface EngineEditLayers {
  layers: EngineLayer[];
  /** Whether it may have changed what the engine's text shaping returns. */
  shaping: boolean;
  /** For an undo or redo: its change set, as named MessagePack, to persist. */
  changeSet?: Uint8Array;
  /** For an undo or redo: whether it left the font as last saved. */
  matchesSaved?: boolean;
}

/**
 * What applying intents within the open edit did, without the font-level
 * records an `EngineEdit` carries: the layers they touched, and whether they
 * changed what the engine's kerning, source-metric and shaping reads return.
 */
export interface EngineStage {
  layers: EngineLayer[];
  kerning: boolean;
  sourceMetrics: boolean;
  shaping: boolean;
}

/** A contour an edit kept as it was: the one with this id in the structure the edit started from. */
export interface KeptContour {
  id: ContourId;
  kept: true;
}

/** A layer's structure after a structural edit; the contours it kept come by id alone. */
export interface EngineStructure extends Omit<GlyphStructure, "contours"> {
  contours: readonly (ContourData | KeptContour)[];
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

/// Why the store did not answer.
#[derive(Debug, thiserror::Error)]
enum HostError {
    #[error("the store request threw: {0}")]
    Threw(String),

    #[error("the store request's reply has {0}")]
    NotAReply(&'static str),

    #[error(transparent)]
    Store(#[from] StoreReadError),

    #[error("the store returned layers that do not decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
}

impl From<JsValue> for HostError {
    fn from(thrown: JsValue) -> Self {
        Self::Threw(format!("{thrown:?}"))
    }
}

/// A `StoreReply`'s keys, made once: each `JsValue::from_str` decodes its text
/// into a new JavaScript string.
struct ReplyKeys {
    numbers: JsValue,
    blobs: JsValue,
}

thread_local! {
    static REPLY_KEYS: ReplyKeys = ReplyKeys {
        numbers: JsValue::from_str("numbers"),
        blobs: JsValue::from_str("blobs"),
    };
}

/// `value` as a `T`, or [`HostError::NotAReply`] saying it is `what`.
fn cast<T: JsCast>(value: JsValue, what: &'static str) -> Result<T, HostError> {
    value.dyn_into().map_err(|_| HostError::NotAReply(what))
}

/// Sends one encoded request through the editor's `StoreRequest` and reads
/// its reply into this module's memory, the one copy each blob makes.
fn send(request: &Function, method: u32, message: Packed) -> Result<Packed, HostError> {
    let blobs: Array = message
        .blobs
        .iter()
        .map(|blob| JsValue::from(Uint8Array::from(&blob[..])))
        .collect();
    let reply = request.call3(
        &JsValue::NULL,
        &JsValue::from(method),
        &Float64Array::from(&message.numbers[..]),
        &blobs,
    )?;
    let (numbers, blobs) = REPLY_KEYS.with(|keys| {
        Ok::<_, HostError>((
            Reflect::get(&reply, &keys.numbers)?,
            Reflect::get(&reply, &keys.blobs)?,
        ))
    })?;
    let numbers = cast::<Float64Array>(numbers, "numbers that are not a Float64Array")?.to_vec();
    let blobs = cast::<Array>(blobs, "blobs that are not an array")?
        .iter()
        .map(|blob| Ok(cast::<Uint8Array>(blob, "a blob that is not a Uint8Array")?.to_vec()))
        .collect::<Result<_, HostError>>()?;
    Ok(Packed { numbers, blobs })
}

/// The editor's `StoreRequest` as the session's [`LayerSource`], through a
/// [`StoreReaderClient`].
struct HostLayers<'a>(&'a Function);

impl HostLayers<'_> {
    fn client(
        &self,
    ) -> StoreReaderClient<CarryingNames<impl Fn(u32, Packed) -> Result<Packed, HostError> + '_>>
    {
        StoreReaderClient(CarryingNames(|method, message| {
            send(self.0, method, message)
        }))
    }
}

impl LayerSource for HostLayers<'_> {
    type Error = HostError;

    fn load_layers(&mut self, layer_ids: &[LayerId]) -> Result<Vec<GlyphLayer>, HostError> {
        let bytes = self.client().layers(layer_ids.to_vec())??;
        Ok(rmp_serde::from_slice(&bytes.0)?)
    }

    fn bases_of(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, HostError> {
        Ok(self.client().bases_of(glyph_ids.to_vec())??)
    }

    fn composites_of(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<GlyphId>, HostError> {
        Ok(self.client().composites_of(glyph_ids.to_vec())??)
    }
}

impl RecordSource for HostLayers<'_> {
    type Error = HostError;

    fn component_bases(&mut self, glyph_ids: &[GlyphId]) -> Result<Vec<Vec<GlyphId>>, HostError> {
        if glyph_ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self.client().component_bases(glyph_ids.to_vec())??)
    }

    fn glyph_data_categories(
        &mut self,
        glyphs: &[NamedGlyph],
    ) -> Result<Vec<GlyphDataCategory>, HostError> {
        if glyphs.is_empty() {
            return Ok(Vec::new());
        }
        self.client().glyph_data_categories(glyphs.to_vec())
    }

    fn attaching_anchor_layers(
        &mut self,
        layer_ids: &[LayerId],
    ) -> Result<Vec<LayerId>, HostError> {
        if layer_ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .client()
            .attaching_anchor_layers(layer_ids.to_vec())??)
    }
}

impl From<HostError> for StoreReadError {
    fn from(error: HostError) -> Self {
        match error {
            HostError::Store(error) => error,
            error => Self::Unreadable {
                detail: error.to_string(),
            },
        }
    }
}

/// An open session, the store request it reads through, its undo history, the
/// session as it stood when the open edit began, to go back to if it is
/// cancelled, and the ids the editor's reads name by number.
pub(crate) struct Engine {
    pub(crate) session: EngineSession,
    source: Function,
    history: EditHistory,
    before_edit: Option<EngineSession>,
    pub(crate) ids: InternedIds,
    /// The intents `EngineEdits::hold` sent, which the next apply, stage or
    /// preview takes.
    pub(crate) held: Vec<FontIntent>,
    /// The font-level records the latest apply, undo or redo changed, until
    /// `EngineEdits::replacement` takes them.
    pub(crate) replaced: Option<FontReplacement>,
    /// The variation the reads evaluate, derived from the session's font on
    /// first read and again once the font's axes, mappings or source
    /// locations differ from the ones it was derived from; read it through
    /// [`Engine::variation`].
    variation: RefCell<Option<Rc<FontVariation>>>,
    /// The shaper text shapes with, compiled from the session's font when
    /// text is first shaped.
    pub(crate) shaping: TextShaping,
    /// The store's answers for glyph records and the shaper's source, each
    /// asked once: glyph data's categories by name and codepoints, and the
    /// attaching anchors of layers the session has not loaded.
    records: RefCell<RecordCache>,
    /// What the open edit's applies changed so far, so that what was built
    /// from them is dropped when the session goes back to where it began.
    edit_impact: FontChangeImpact,
}

impl Engine {
    /// What an edit did as an `EngineEditLayers`: its touched layers. Keeps the
    /// font-level records it changed for `EngineEdits::replacement`, in the
    /// native workspace's packed shape, with the records of the glyphs it
    /// changed as they now stand.
    fn edit_object(&mut self, before: &Font, applied: &AppliedIntents) -> Result<Object, JsError> {
        let layers = engine_layers(before, &applied.layers)?;
        let edit = Object::new();
        set(&edit, "layers", &layers)?;
        let impact = applied.changes.impact();
        self.changed(impact);
        set(
            &edit,
            "shaping",
            &JsValue::from_bool(impact.intersects(TextShaping::INPUTS)),
        )?;
        let mut replaced = FontReplacement::changed_by(
            self.session.font(),
            impact.difference(FontChangeImpact::GLYPHS),
        )?;
        if impact.contains(FontChangeImpact::GLYPHS) {
            let glyph_changes = self
                .session
                .glyph_record_changes(
                    &mut self
                        .records
                        .borrow_mut()
                        .reading(&mut HostLayers(&self.source)),
                    &applied.changes,
                )
                .map_err(js_error)?;
            replaced
                .get_or_insert_with(FontReplacement::default)
                .glyph_changes = Some(glyph_changes);
        }
        self.replaced = replaced;
        Ok(edit)
    }

    /// Drops what the reads built from inputs an apply with `impact` changed.
    fn changed(&mut self, impact: FontChangeImpact) {
        self.shaping.forget_if_changed(impact);
        self.edit_impact |= impact;
    }

    /// Drops what the reads built from the open edit's applies, as when the
    /// session goes back to where the edit began.
    fn went_back(&mut self) {
        self.shaping.forget_if_changed(self.edit_impact);
        self.edit_impact = FontChangeImpact::empty();
    }

    /// The variation the reads evaluate for the session's font as it stands.
    pub(crate) fn variation(&self) -> Rc<FontVariation> {
        FontVariation::of(&self.variation, self.session.font())
    }

    /// Every glyph's record, in name order, as the session's font stands.
    pub(crate) fn glyph_records(&self) -> Result<shift_font::GlyphRecords, StoreReadError> {
        Ok(self.session.glyph_records(
            &mut self
                .records
                .borrow_mut()
                .reading(&mut HostLayers(&self.source)),
        )?)
    }

    /// What the font's shaper font compiles from, as the session's font stands.
    pub(crate) fn shaper_font_source(
        &self,
    ) -> Result<shift_font::ShaperFontSource, StoreReadError> {
        Ok(self.session.shaper_font_source(
            &mut self
                .records
                .borrow_mut()
                .reading(&mut HostLayers(&self.source)),
        )?)
    }

    /// The intents held for this apply, stage or preview, as one set.
    fn take_held(&mut self) -> FontIntentSet {
        FontIntentSet {
            intents: std::mem::take(&mut self.held),
        }
    }
}

impl Engine {
    /// Loads `layer_ids` that are still placeholders, from the source.
    pub(crate) fn load_layers(&mut self, layer_ids: Vec<LayerId>) -> Result<(), JsError> {
        self.session
            .load_layers(&mut HostLayers(&self.source), layer_ids)
            .map_err(js_error)
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
/// store's reader, with every layer a placeholder; it loads layers through
/// `source`, a `StoreRequest`. Returns its handle.
///
/// # Errors
///
/// Fails when `directory` does not decode to a font.
#[wasm_bindgen(js_name = engineOpen)]
pub fn engine_open(
    directory: &[u8],
    #[wasm_bindgen(unchecked_param_type = "StoreRequest")] source: Function,
) -> Result<u32, JsError> {
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
            held: Vec::new(),
            replaced: None,
            variation: RefCell::default(),
            shaping: TextShaping::default(),
            records: RefCell::new(RecordCache::default()),
            edit_impact: FontChangeImpact::empty(),
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
        engine.edit_impact = FontChangeImpact::empty();
        engine.history.begin();
        Ok(())
    })
}

/// Applies the intents `EngineEdits::hold` sent as part of the open edit:
/// loads what they read, applies them, and returns every layer they touched
/// and the font-level records they changed. Takes the held intents, so a
/// second call applies none.
///
/// # Errors
///
/// Fails when no edit is open, when the source fails, or when the intents are
/// invalid; the session is then as loading left it.
#[wasm_bindgen(js_name = engineApply, unchecked_return_type = "EngineEditLayers")]
pub fn engine_apply(handle: u32) -> Result<JsValue, JsError> {
    with_engine(handle, |engine| {
        let intents = engine.take_held();
        if !engine.history.is_open() {
            return Err(JsError::new("no edit is open; begin one first"));
        }
        let before = engine.session.font().clone();
        let applied = engine
            .session
            .apply(&mut HostLayers(&engine.source), &intents)
            .map_err(apply_error)?;
        let edit = engine.edit_object(&before, &applied)?;
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
        engine.went_back();
        engine.history.begin();
        Ok(())
    })
}

/// Applies the held intents as part of the open edit, as [`engine_apply`]
/// does, but returns only the layers they touched and which reads they
/// changed, not the font-level records: a gesture's frame, whose records are
/// built once when it commits.
///
/// # Errors
///
/// As [`engine_apply`].
#[wasm_bindgen(js_name = engineStage, unchecked_return_type = "EngineStage")]
pub fn engine_stage(handle: u32) -> Result<JsValue, JsError> {
    with_engine(handle, |engine| {
        let intents = engine.take_held();
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
        engine.changed(impact);
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
        set(
            &stage,
            "shaping",
            &JsValue::from_bool(impact.intersects(TextShaping::INPUTS)),
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
        engine.edit_impact = FontChangeImpact::empty();
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
            engine.went_back();
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
#[wasm_bindgen(js_name = engineUndo, unchecked_return_type = "EngineEditLayers | undefined")]
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
#[wasm_bindgen(js_name = engineRedo, unchecked_return_type = "EngineEditLayers | undefined")]
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
    engine: &mut Engine,
    before: &Font,
    applied: Option<AppliedIntents>,
) -> Result<JsValue, JsError> {
    let Some(applied) = applied else {
        return Ok(JsValue::UNDEFINED);
    };
    let edit = engine.edit_object(before, &applied)?;
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

/// Returns every layer applying the held intents would touch, as they would
/// be, without keeping the edit: a preview for a gesture under way. What the
/// intents read stays loaded.
///
/// # Errors
///
/// As [`engine_apply`].
#[wasm_bindgen(js_name = enginePreview, unchecked_return_type = "EngineLayer[]")]
pub fn engine_preview(handle: u32) -> Result<Array, JsError> {
    with_engine(handle, |engine| {
        let set = engine.take_held();
        let previewed = engine
            .session
            .preview(&mut HostLayers(&engine.source), &set)
            .map_err(apply_error)?;
        // A preview keeps nothing, so the session's font is what it started from.
        engine_layers(engine.session.font(), &previewed.layers)
    })
}

/// A Rust error as the `Error` an engine call throws, carrying its message.
fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

fn apply_error(error: ApplyError<HostError>) -> JsError {
    match error {
        ApplyError::Load(error) => js_error(error),
        ApplyError::Engine(error) => js_error(error),
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
    let glyph_ids = values::parse_id_list::<GlyphId>(&glyph_ids)?;
    with_engine(handle, |engine| {
        engine
            .session
            .load_glyph_closure(&mut HostLayers(&engine.source), glyph_ids)
            .map_err(js_error)
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
