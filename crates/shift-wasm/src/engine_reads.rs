//! What the editor reads from the editing engine's font: its axes, sources,
//! kerning and glyph records, as shift-font's own types; kerning and source
//! metrics at a place; and the per-frame variation reads, interpolation
//! weights and axis mapping, answered by the same shift-font code the
//! workspace and export run. Every read answers from the session's font as it
//! stands, unsaved edits included.
//!
//! The [`EngineReads`] interface is answered only with the `engine` feature,
//! beside the session it reads ([`crate::engine`]). The interface and its
//! types are declared with `engine-protocol` alone, so the editor's side
//! generates without building the session.
//!
//! The hot reads name glyphs, sources and source sets by numbers the session
//! interns, not by the engine module's name table: the editor interns a
//! glyph or source id once with `engineGlyphNumbers` or `engineSourceNumbers`,
//! and a glyph's ordered source set once with `engineSourceSetNumber`, and
//! passes its number from then on. A location crosses as numbers in the
//! font's axis order, NaN for an axis at its default.
//!
//! The session derives each interned source set's interpolation basis, and
//! the font's compiled axis mappings, from its font when a read first needs
//! them, and keeps them with the axes, mappings and source locations they
//! were derived from: a read whose font no longer has those derives them
//! again ([`FontVariation`]).

use pack::Pack;
use shift_engine::StoreReadError;
use shift_font::{
    Axis, FontChangeFlag, GlyphId, GlyphRecords, MetricValue, MissingKerningOrigin,
    ResolvedKerning, Source,
};
use shift_layout::{LayoutError, LayoutRequest, TextLayout};
pub use shift_shape::{FeatureDefault, FeatureGroup, FontFeature};
use shift_wire::KerningSnapshot;

/// What the editor reads from one engine session's font. Glyphs and sources
/// are named by the numbers the session interned for them; `glyphs` lists
/// pairs, each pair's first glyph then its second.
#[pack::interface]
pub trait EngineReads {
    /// The kerning between glyph pairs in font units, as
    /// `Font::kerning_blend_at_source` or `Font::kerning_blend_at` weighs the
    /// sources: at `source` when given, else at `location`, in the font's axis
    /// order with NaN for an axis default. Null for a source or glyph number
    /// the session never interned, or a location the font's basis cannot
    /// evaluate. A glyph the font lacks kerns nothing.
    fn kerning_run(
        &self,
        source: Option<usize>,
        location: Vec<f64>,
        glyphs: Vec<usize>,
    ) -> Option<Vec<f64>>;
    /// For each pair, the authored pair an edit to it at `source` changes, as
    /// `Kerning::resolve` and `Kerning::editable_pair` find it.
    fn kerning_pairs(&self, source: usize, glyphs: Vec<usize>) -> Vec<EditablePair>;
    /// The masters' metrics interpolated at `location`, in the font's axis
    /// order with NaN for an axis default, by
    /// `SourceMetricInterpolation::resolve`; null for a static font or one
    /// whose masters cannot be interpolated.
    fn source_metrics_at(&self, location: Vec<f64>) -> Option<InterpolatedMetrics>;
    /// The font's axes, in order.
    fn axes(&self) -> Vec<Axis>;
    /// The font's master sources, each with its metric values by metric row.
    fn sources(&self) -> Vec<Source>;
    /// The font's kerning: its groups, each source's pairs, and the basis
    /// kerning interpolates over.
    fn kerning(&self) -> KerningSnapshot;
    /// The pairs authored at `source` that name `glyph` on a side, directly
    /// or through its group at that side, as `Kerning::pairs_naming` finds
    /// them; empty for a number the session never interned.
    fn kerning_pairs_naming(&self, source: usize, glyph: usize) -> Vec<ResolvedKerning>;
    /// Where a pair's value comes from at `source` when it authors no pair
    /// for it: `Font::missing_kerning_origin`; unkerned for a number the
    /// session never interned.
    fn missing_kerning_origin(&self, source: usize) -> MissingKerningOrigin;
    /// Every glyph's record, sorted by name: its own fields from the
    /// session's font, the component bases of glyphs it has not loaded and
    /// glyph data's categories from the store's reader.
    ///
    /// # Errors
    ///
    /// Returns [`StoreReadError`] when the store's reader cannot answer.
    fn glyph_records(&self) -> Result<GlyphRecords, StoreReadError>;
    /// Lays text out over the session's font, unsaved edits included, as
    /// `shift_layout::TextLayout::new` does: shaped with the session's
    /// shaper (brought up to date as [`Self::shape_paragraphs`] does), with
    /// kerning, mark attachment and cursive joins at each generated feature's
    /// insert marker, then broken into lines, ordered, aligned, and given
    /// caret stops. Text that cannot be shaped is laid out as typed, with
    /// the reason.
    ///
    /// The session compiles its shaper font when text is first laid out, and
    /// again before the next layout after an edit that may change the glyph
    /// directory or the axes and their mappings, only when something the
    /// compile reads changed; feature code with errors keeps the last font.
    /// What the compile reads of layers the session has not loaded and glyph
    /// data's categories come from the store's reader.
    ///
    /// Glyphs whose layers the session has not loaded lay out from their
    /// placeholders; `unloaded` lists them, for the editor to load and lay
    /// out again.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError::TooLong`] for text too long to index.
    fn layout_text(&self, request: TextLayoutRequest) -> Result<PlacedText, LayoutError>;
    /// The flags whose change may change what [`Self::layout_text`]
    /// returns.
    fn layout_inputs(&self) -> Vec<FontChangeFlag>;
    /// The features the session's shaper font defines, once per tag in tag
    /// order, each with the name it is shown by, what it does when text does
    /// not set it, and its group, as `shift_shape::Shaper::features` lists
    /// them. The shaper is brought up to date first, as for
    /// [`Self::layout_text`].
    ///
    /// # Errors
    ///
    /// Returns [`FeatureListError`] when there is no shaper font, saying
    /// why, or it cannot be read.
    fn font_features(&self) -> Result<Vec<FontFeature>, FeatureListError>;
    /// The flags whose change may change the session's shaper font, and so
    /// what [`Self::font_features`] returns.
    fn shaper_inputs(&self) -> Vec<FontChangeFlag>;
    /// Every substitution feature `tag` can make in the session's shaper
    /// font, ordered by output glyph then input, as
    /// `shift_shape::Shaper::feature_substitutions` reads them from its
    /// `GSUB`: lookups that contextual rules call included, glyphs no
    /// character reaches included. Empty for a positioning feature or a tag
    /// the font does not define. Changes when a flag in
    /// [`Self::shaper_inputs`] does.
    ///
    /// # Errors
    ///
    /// Returns [`FeatureListError`] for an invalid tag, when there is no
    /// shaper font, saying why, or when its `GSUB` cannot be read.
    fn feature_substitutions(
        &self,
        tag: String,
    ) -> Result<Vec<FeatureSubstitution>, FeatureListError>;
    /// Whether shaping text applies feature `tag` when the text sets it to
    /// `setting` (null when it leaves it): `FeatureDefault::applies` for the
    /// session's shaper font's feature: the setting wins, else its default.
    /// False for a tag the shaper font does not define. Changes when a flag
    /// in [`Self::shaper_inputs`] does.
    ///
    /// # Errors
    ///
    /// Returns [`FeatureListError`] when there is no shaper font, saying
    /// why, or it cannot be read.
    fn feature_applies(&self, tag: String, setting: Option<u32>) -> Result<bool, FeatureListError>;
    /// Every interned source set's weights at a design location, as the
    /// basis the session's font gives each set evaluates them
    /// (`InterpolationBasis::weights_at`): the weights of the sets a frame
    /// draws, read once per location.
    fn source_set_weights(&self, location: Vec<f64>) -> SourceSetWeights;
    /// The weights of the interned source sets `sets`, as
    /// [`EngineReads::source_set_weights`] gives each, one set after
    /// another, at an external location mapped once through the font's axis
    /// mappings: a Slug atlas's weight sets in one read. Null when a set was
    /// never interned, or its sources are missing from the font or form no
    /// model.
    fn atlas_weights(&self, sets: Vec<usize>, external: Vec<f64>) -> Option<Vec<f64>>;
    /// An external location's design location, through the font's axis
    /// mappings, exactly once: `map_location_with_bases`.
    fn design_location(&self, external: Vec<f64>) -> Vec<f64>;
    /// The external location a design location's mapping came from, NaN on
    /// internal axes: `unmap_location_with_bases`.
    fn external_location(&self, design: Vec<f64>) -> Vec<f64>;
}

/// Text to lay out, and where.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct TextLayoutRequest {
    pub text: LayoutRequest,
    /// The design location to lay out at, in the font's axis order with NaN
    /// for an axis default, as [`EngineReads::kerning_run`] takes it.
    pub location: Vec<f64>,
    /// A source, by the number the session interned, to lay out at instead,
    /// as its own layers draw.
    pub source: Option<usize>,
}

/// Why [`EngineReads::font_features`] could not list the features. Its
/// details are text: the shaper's errors cannot cross to the editor.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum FeatureListError {
    /// No shaper font could be made from the font, so text lays out as
    /// typed; `reason` is why.
    #[error("the font has no shaper font: {reason}")]
    NoShaper { reason: String },
    /// The shaper font could not be read.
    #[error("the shaper font could not be read: {detail}")]
    Unreadable { detail: String },
    /// A feature was asked for by a tag that is not four characters.
    #[error("`{tag}` is not a feature tag")]
    InvalidTag { tag: String },
}

impl FeatureListError {
    /// The shaper font could not be read, for `error`.
    pub(crate) fn unreadable(error: impl std::fmt::Display) -> Self {
        Self::Unreadable {
            detail: error.to_string(),
        }
    }
}

/// Text as [`EngineReads::layout_text`] laid it out.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PlacedText {
    pub layout: TextLayout,
    /// The glyphs it shows whose layers the session has not loaded, which
    /// laid out from their placeholders.
    pub unloaded: Vec<GlyphId>,
}

/// One substitution a feature can make: `input` in the text becomes `output`.
#[derive(Clone, Debug, PartialEq, Eq, Pack)]
pub struct FeatureSubstitution {
    /// The glyphs replaced; more than one for a ligature.
    pub input: Vec<GlyphId>,
    pub output: GlyphId,
}

/// The authored pair an edit to the kerning between two glyphs at a source changes.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct EditablePair {
    /// Whether the pair is authored there, so it is the kerning that applies; false for the most general pair the glyphs' groups allow.
    pub authored: bool,
    /// Whether the pair's first side is the first glyph's group rather than the glyph.
    pub first_group: bool,
    /// Whether the pair's second side is the second glyph's group rather than the glyph.
    pub second_group: bool,
    /// The pair's value there in font units; zero when it is not authored.
    pub amount: f64,
}

/// Source metrics between the masters, as export interpolates them; a technical field is present only when every master sets it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct InterpolatedMetrics {
    /// Each metric definition's value, in the font's definition order.
    pub metrics: Vec<MetricValue>,
    pub italic_angle: Option<f64>,
    pub line_gap: Option<f64>,
    pub underline_position: Option<f64>,
    pub underline_thickness: Option<f64>,
}

/// The weights of every source set a session interned, at one location.
#[derive(Clone, Debug, Default, PartialEq, Pack)]
pub struct SourceSetWeights {
    /// Each set's weights, one per source in the set's order, one set after
    /// another in number order. A set whose sources the font lacks, or that
    /// forms no model, has NaN for each.
    #[pack(numbers)]
    pub weights: Vec<f64>,
    /// Where each set's weights start in `weights`, by set number, then
    /// where the last set's end: set `n`'s weights are
    /// `weights[starts[n]..starts[n + 1]]`.
    pub starts: Vec<usize>,
}

#[cfg(feature = "engine")]
pub(crate) use exports::{FontVariation, InternedIds};

#[cfg(feature = "engine")]
mod exports {
    use std::cell::RefCell;
    use std::collections::{BTreeSet, HashMap};
    use std::hash::Hash;
    use std::rc::Rc;

    use shift_engine::StoreReadError;
    use shift_font::naming::new_anchor_name;
    use shift_font::{
        AxisMapping, AxisMappingBasis, DesignLocation, ExternalLocation, Font, FontCopyId, GlyphId,
        GlyphRecords, InterpolationBasis, Kerning, KerningSide, LayerId, MissingKerningOrigin,
        ResolvedKerning, SourceId,
    };
    use shift_wire::values::{self, WireParse};
    use wasm_bindgen::prelude::*;

    use super::{
        Axis, EditablePair, EngineReads, FeatureListError, FeatureSubstitution, FontChangeFlag,
        FontFeature, InterpolatedMetrics, KerningSnapshot, LayoutError, PlacedText, Source,
        SourceSetWeights, TextLayoutRequest, engine_reads_request,
    };
    use crate::engine::{Engine, with_engine};
    use crate::shaping::{TextPlace, TextShaping};
    use crate::variation::{design_values, external_values, to_location, weights_at};

    /// The ids a session's reads name by number, each interned once.
    #[derive(Default)]
    pub(crate) struct InternedIds {
        glyphs: IdTable<GlyphId>,
        sources: IdTable<SourceId>,
        source_sets: IdTable<Vec<SourceId>>,
    }

    /// What the variation reads evaluate, derived from the session's font:
    /// its compiled axis mappings, and each interned source set's basis,
    /// derived on the set's first read. Kept with the inputs it was derived
    /// from, so a font with other inputs derives it again
    /// ([`FontVariation::of`]): no edit, undo or rewind can leave it stale.
    pub(crate) struct FontVariation {
        inputs: VariationInputs,
        /// The last font copy found to have `inputs`: a read of the same
        /// copy skips comparing them.
        checked: RefCell<FontCopyId>,
        mappings: Vec<AxisMappingBasis>,
        bases: RefCell<HashMap<usize, Option<Rc<InterpolationBasis>>>>,
    }

    impl FontVariation {
        /// The variation `held` keeps for `font`, derived again first when
        /// `font`'s axes, axis mappings or source locations are not the ones
        /// it was derived from.
        pub(crate) fn of(held: &RefCell<Option<Rc<Self>>>, font: &Font) -> Rc<Self> {
            let mut held = held.borrow_mut();
            if let Some(variation) = held.as_ref()
                && variation.derived_from(font)
            {
                return Rc::clone(variation);
            }
            let variation = Rc::new(Self::derive(font));
            *held = Some(Rc::clone(&variation));
            variation
        }

        /// `font`'s compiled axis mappings, and no source set's basis yet. A
        /// font whose mappings cannot be compiled maps as an unmapped font
        /// does.
        /// Whether `font` has the inputs this was derived from.
        fn derived_from(&self, font: &Font) -> bool {
            if font.is_copy(&self.checked.borrow()) {
                return true;
            }
            if !self.inputs.describe(font) {
                return false;
            }
            *self.checked.borrow_mut() = font.copy_id();
            true
        }

        fn derive(font: &Font) -> Self {
            Self {
                inputs: VariationInputs::of(font),
                checked: RefCell::new(font.copy_id()),
                mappings: font.axis_mapping_bases().unwrap_or_default(),
                bases: RefCell::default(),
            }
        }

        /// The basis `font` gives the interned set `set`, derived on first
        /// use; none for a set never interned, or whose sources `font` lacks
        /// or form no model.
        fn basis(
            &self,
            set: usize,
            font: &Font,
            ids: &InternedIds,
        ) -> Option<Rc<InterpolationBasis>> {
            self.bases
                .borrow_mut()
                .entry(set)
                .or_insert_with(|| {
                    let source_ids = ids.source_sets.get(set)?;
                    font.interpolation_basis_for(source_ids)
                        .ok()
                        .flatten()
                        .map(Rc::new)
                })
                .clone()
        }
    }

    /// The parts of a font its variation is derived from: its axes, its axis
    /// mappings, and where each source sits.
    #[derive(PartialEq)]
    struct VariationInputs {
        axes: Vec<Axis>,
        mappings: Vec<AxisMapping>,
        sources: Vec<SourcePlace>,
    }

    /// One source's id and design location.
    #[derive(PartialEq)]
    struct SourcePlace {
        id: SourceId,
        location: DesignLocation,
    }

    impl From<&Source> for SourcePlace {
        fn from(source: &Source) -> Self {
            Self {
                id: source.id(),
                location: source.location().clone(),
            }
        }
    }

    impl VariationInputs {
        fn of(font: &Font) -> Self {
            Self {
                axes: font.axes().to_vec(),
                mappings: font.axis_mappings().to_vec(),
                sources: font.sources().iter().map(SourcePlace::from).collect(),
            }
        }

        /// Whether `font` has exactly these inputs; compares in place, so a
        /// read that finds them unchanged copies nothing.
        fn describe(&self, font: &Font) -> bool {
            self.axes == font.axes()
                && self.mappings == font.axis_mappings()
                && self.sources.len() == font.sources().len()
                && self
                    .sources
                    .iter()
                    .zip(font.sources())
                    .all(|(place, source)| {
                        place.id == source.id() && &place.location == source.location()
                    })
        }
    }

    /// Ids by number, and each id's number.
    struct IdTable<T> {
        ids: Vec<T>,
        numbers: HashMap<T, u32>,
    }

    impl<T> Default for IdTable<T> {
        fn default() -> Self {
            Self {
                ids: Vec::new(),
                numbers: HashMap::new(),
            }
        }
    }

    impl<T: WireParse + Clone + Eq + Hash> IdTable<T> {
        /// Parses each of `ids` and returns its number, interning the new ones.
        fn intern(&mut self, ids: &[String]) -> Result<Vec<u32>, JsError> {
            values::parse_id_list::<T>(ids)?
                .into_iter()
                .map(|id| self.intern_one(id))
                .collect()
        }
    }

    impl<T: Clone + Eq + Hash> IdTable<T> {
        /// The number `id` is interned as, interning it when new.
        fn intern_one(&mut self, id: T) -> Result<u32, JsError> {
            if let Some(number) = self.numbers.get(&id) {
                return Ok(*number);
            }
            let number = u32::try_from(self.ids.len())?;
            self.ids.push(id.clone());
            self.numbers.insert(id, number);
            Ok(number)
        }
    }

    impl<T> IdTable<T> {
        /// The id interned as `number`, if any.
        fn get(&self, number: usize) -> Option<&T> {
            self.ids.get(number)
        }
    }

    /// Interns glyph ids for this session's reads and returns each one's
    /// number, in order. A number stays the glyph's for the session's life,
    /// whether or not the font has the glyph.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle or an id that is not a glyph id.
    #[wasm_bindgen(js_name = engineGlyphNumbers)]
    pub fn engine_glyph_numbers(handle: u32, glyph_ids: Vec<String>) -> Result<Vec<u32>, JsError> {
        with_engine(handle, |engine| engine.ids.glyphs.intern(&glyph_ids))
    }

    /// Interns source ids for this session's reads and returns each one's
    /// number, in order, as [`engine_glyph_numbers`] does for glyphs.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle or an id that is not a source id.
    #[wasm_bindgen(js_name = engineSourceNumbers)]
    pub fn engine_source_numbers(
        handle: u32,
        source_ids: Vec<String>,
    ) -> Result<Vec<u32>, JsError> {
        with_engine(handle, |engine| engine.ids.sources.intern(&source_ids))
    }

    /// Interns an ordered source set, as a glyph's interpolation basis lists
    /// its sources, for [`EngineReads::interpolation_weights`], and returns
    /// its number. A number stays the set's for the session's life, whether
    /// or not the font has its sources.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle or an id that is not a source id.
    #[wasm_bindgen(js_name = engineSourceSetNumber)]
    pub fn engine_source_set_number(handle: u32, source_ids: Vec<String>) -> Result<u32, JsError> {
        let set = values::parse_id_list::<SourceId>(&source_ids)?;
        with_engine(handle, |engine| engine.ids.source_sets.intern_one(set))
    }

    /// Runs one [`EngineReads`] method on the session `handle`. An unknown
    /// handle replies with nothing, which the editor reads as null or empty.
    #[wasm_bindgen(js_name = engineReadsRequest)]
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
                engine_reads_request(&*engine, method, input, blobs, names)
            }))
        })
        .unwrap_or_default()
    }

    impl EngineReads for Engine {
        fn axes(&self) -> Vec<Axis> {
            self.session.font().axes().to_vec()
        }

        fn sources(&self) -> Vec<Source> {
            self.session.font().masters().cloned().collect()
        }

        fn kerning(&self) -> KerningSnapshot {
            KerningSnapshot::from(self.session.font())
        }

        fn kerning_run(
            &self,
            source: Option<usize>,
            location: Vec<f64>,
            glyphs: Vec<usize>,
        ) -> Option<Vec<f64>> {
            let font = self.session.font();
            let blend = match source {
                Some(number) => font
                    .kerning_blend_at_source(*self.ids.sources.get(number)?)
                    .ok()?,
                None => font
                    .kerning_blend_at(&design_location(font, &location))
                    .ok()?,
            };
            let ids = &self.ids.glyphs;
            let pairs = glyphs
                .chunks_exact(2)
                .map(|pair| match pair {
                    &[first, second] => ids.get(first).copied().zip(ids.get(second).copied()),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?;
            Some(blend.values(font.kerning(), pairs))
        }

        fn kerning_pairs(&self, source: usize, glyphs: Vec<usize>) -> Vec<EditablePair> {
            let kerning = self.session.font().kerning();
            let ids = &self.ids.glyphs;
            let source = self.ids.sources.get(source);
            glyphs
                .chunks_exact(2)
                .map(|pair| {
                    let (&[first, second], Some(source)) = (pair, source) else {
                        return UNKERNED;
                    };
                    match (ids.get(first), ids.get(second)) {
                        (Some(first), Some(second)) => {
                            editable_pair(kerning, *source, *first, *second)
                        }
                        _ => UNKERNED,
                    }
                })
                .collect()
        }

        fn source_metrics_at(&self, location: Vec<f64>) -> Option<InterpolatedMetrics> {
            interpolated_metrics(self.session.font(), &location)
        }

        fn kerning_pairs_naming(&self, source: usize, glyph: usize) -> Vec<ResolvedKerning> {
            let (Some(source_id), Some(glyph_id)) =
                (self.ids.sources.get(source), self.ids.glyphs.get(glyph))
            else {
                return Vec::new();
            };
            self.session
                .font()
                .kerning()
                .pairs_naming(*source_id, *glyph_id)
                .collect()
        }

        fn missing_kerning_origin(&self, source: usize) -> MissingKerningOrigin {
            match self.ids.sources.get(source) {
                Some(source_id) => self.session.font().missing_kerning_origin(*source_id),
                None => MissingKerningOrigin::Unkerned,
            }
        }

        fn glyph_records(&self) -> Result<GlyphRecords, StoreReadError> {
            Self::glyph_records(self)
        }

        fn layout_text(&self, request: TextLayoutRequest) -> Result<PlacedText, LayoutError> {
            // A gesture's preview shows in text while it is under way.
            let font = self
                .previewed
                .as_ref()
                .unwrap_or_else(|| self.session.font());
            let place = self.text_place(&request);
            let layout = self.shaping.layout_text(
                font,
                || self.shaper_font_source(),
                &request.text,
                place,
            )?;
            let shown: BTreeSet<GlyphId> = layout
                .glyphs
                .iter()
                .filter_map(|glyph| glyph.glyph_id)
                .collect();
            let residency = self.session.residency();
            let unloaded = shown
                .into_iter()
                .filter(|glyph| {
                    font.layer_ids_of_glyphs([glyph])
                        .into_iter()
                        .any(|layer| residency.is_unloaded(layer))
                })
                .collect();
            Ok(PlacedText { layout, unloaded })
        }

        fn layout_inputs(&self) -> Vec<FontChangeFlag> {
            FontChangeFlag::of(TextShaping::LAYOUT_INPUTS).collect()
        }

        fn font_features(&self) -> Result<Vec<FontFeature>, FeatureListError> {
            self.shaping
                .features(self.session.font(), || self.shaper_font_source())
        }

        fn shaper_inputs(&self) -> Vec<FontChangeFlag> {
            FontChangeFlag::of(TextShaping::INPUTS).collect()
        }

        fn feature_substitutions(
            &self,
            tag: String,
        ) -> Result<Vec<FeatureSubstitution>, FeatureListError> {
            self.shaping.feature_substitutions(
                self.session.font(),
                || self.shaper_font_source(),
                &tag,
            )
        }

        fn feature_applies(
            &self,
            tag: String,
            setting: Option<u32>,
        ) -> Result<bool, FeatureListError> {
            self.shaping.feature_applies(
                self.session.font(),
                || self.shaper_font_source(),
                &tag,
                setting,
            )
        }

        fn source_set_weights(&self, location: Vec<f64>) -> SourceSetWeights {
            let font = self.session.font();
            let variation = self.variation();
            let mut weights = SourceSetWeights::default();
            for (set, source_ids) in self.ids.source_sets.ids.iter().enumerate() {
                weights.starts.push(weights.weights.len());
                let row = match variation.basis(set, font, &self.ids) {
                    Some(basis) => weights_at(&basis, font.axes(), &location),
                    None => vec![f64::NAN; source_ids.len()],
                };
                weights.weights.extend(row);
            }
            weights.starts.push(weights.weights.len());
            weights
        }

        fn atlas_weights(&self, sets: Vec<usize>, external: Vec<f64>) -> Option<Vec<f64>> {
            let font = self.session.font();
            let variation = self.variation();
            let design = design_values(font.axes(), &variation.mappings, &external);
            let mut weights = Vec::new();
            for set in sets {
                let basis = variation.basis(set, font, &self.ids)?;
                weights.extend(weights_at(&basis, font.axes(), &design));
            }
            Some(weights)
        }

        fn design_location(&self, external: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            design_values(font.axes(), &self.variation().mappings, &external)
        }

        fn external_location(&self, design: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            external_values(font.axes(), &self.variation().mappings, &design)
        }
    }

    impl Engine {
        /// Where `request` lays out: at its source, when it names one the
        /// font has, otherwise at its location mapped through the font's axis
        /// mappings; with the kerning there, none when it cannot be blended.
        fn text_place(&self, request: &TextLayoutRequest) -> TextPlace {
            let font = self.session.font();
            let source = request
                .source
                .and_then(|number| self.ids.sources.get(number))
                .and_then(|source_id| font.source(*source_id));
            let external_of = |design: &[f64]| {
                let values = external_values(font.axes(), &self.variation().mappings, design);
                ExternalLocation::from_untyped(to_location(font.axes(), &values))
            };
            let Some(source) = source else {
                return TextPlace {
                    design: design_location(font, &request.location),
                    external: external_of(&request.location),
                    kerning: font
                        .kerning_blend_at(&design_location(font, &request.location))
                        .unwrap_or_default(),
                };
            };
            let design: Vec<f64> = font
                .axes()
                .iter()
                .map(|axis| source.location().get(&axis.id()).unwrap_or(f64::NAN))
                .collect();
            TextPlace {
                design: source.location().clone(),
                external: external_of(&design),
                kerning: font
                    .kerning_blend_at_source(source.id())
                    .unwrap_or_default(),
            }
        }
    }

    /// The glyphs themselves at zero, for a pair that names nothing known.
    const UNKERNED: EditablePair = EditablePair {
        authored: false,
        first_group: false,
        second_group: false,
        amount: 0.0,
    };

    fn editable_pair(
        kerning: &Kerning,
        source_id: SourceId,
        first: GlyphId,
        second: GlyphId,
    ) -> EditablePair {
        let (authored, resolved) = match kerning.resolve(source_id, first, second) {
            Some(resolved) => (true, resolved),
            None => (false, kerning.editable_pair(source_id, first, second)),
        };
        EditablePair {
            authored,
            first_group: matches!(resolved.pair.first, KerningSide::Group(_)),
            second_group: matches!(resolved.pair.second, KerningSide::Group(_)),
            amount: resolved.value,
        }
    }

    fn interpolated_metrics(font: &Font, location: &[f64]) -> Option<InterpolatedMetrics> {
        let interpolation = font.source_metric_interpolation()?;
        let resolved = interpolation
            .resolve(&design_location(font, location), font.axes())
            .ok()?;
        Some(InterpolatedMetrics {
            metrics: interpolation
                .metric_ids()
                .iter()
                .map(|metric_id| {
                    resolved
                        .metric_values()
                        .get(metric_id)
                        .copied()
                        .unwrap_or_default()
                })
                .collect(),
            italic_angle: resolved.italic_angle(),
            line_gap: resolved.line_gap(),
            underline_position: resolved.underline_position(),
            underline_thickness: resolved.underline_thickness(),
        })
    }

    /// The name a new glyph asked to be called `name` takes in the session's
    /// font: `Font::next_available_glyph_name`.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle.
    #[wasm_bindgen(js_name = engineNextGlyphName)]
    pub fn engine_next_glyph_name(handle: u32, name: &str) -> Result<String, JsError> {
        with_engine(handle, |engine| {
            Ok(engine.session.font().next_available_glyph_name(name))
        })
    }

    /// The name a new anchor added to every one of `layer_ids` takes:
    /// `naming::new_anchor_name`, loading the layers first.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle or layer id, or when the source fails.
    #[wasm_bindgen(js_name = engineNewAnchorName)]
    pub fn engine_new_anchor_name(handle: u32, layer_ids: Vec<String>) -> Result<String, JsError> {
        let layer_ids = values::parse_id_list::<LayerId>(&layer_ids)?;
        with_engine(handle, |engine| {
            engine.load_layers(layer_ids.clone())?;
            let font = engine.session.font();
            let layers = layer_ids
                .iter()
                .map(|layer_id| font.require_layer(*layer_id))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| JsError::new(&error.to_string()))?;
            Ok(new_anchor_name(layers))
        })
    }

    fn design_location(font: &Font, values: &[f64]) -> DesignLocation {
        DesignLocation::from_untyped(to_location(font.axes(), values))
    }
}
