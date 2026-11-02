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
use shift_engine::scene::{RevisedNode, SceneNode, TextRun};
use shift_font::glyph_identity::GlyphIdentityChange;
use shift_font::linked_metrics::SideLink;
use shift_font::{
    AnchorId, Axis, ComponentId, Counterparts, CounterpartsError, FontChangeFlag, GlyphId,
    GlyphRecords, LayerId, MetricValue, MissingKerningOrigin, NodeId, PointId, ResolvedKerning,
    Source, SourceId,
};
use shift_text::layout::{LayoutError, TextLayout};

pub use crate::page_layout::{NodeBox, PageLayout, PageLayoutError, PageLayoutRequest, RunLines};
use shift_font::wire::{
    AxisMapping, AxisMappingBasis, FontMetadata, FontMetrics, GlyphSnapshot, KerningSnapshot,
    MetricDefinition, NamedInstance, SourceMetricsInterpolationSnapshot, VariationBasis,
};
pub use shift_text::shape::{FeatureDefault, FeatureGroup, FontFeature};

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
    /// Lays a run's text out over the session's font, unsaved edits
    /// included, with the options its settings give
    /// (`TextRun::layout_request`), as
    /// `shift_text::layout::TextLayout::new` does: shaped with the session's
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
    /// Lays out a page of the session's scene: a box for the page and each
    /// node under it, frames placing their children in rows and columns as
    /// shift-layout does, and each text run's lines at the width the page
    /// gives it. Text is laid out as [`Self::layout_text`] lays it out, at
    /// the request's location or source, so a run wraps where UAX #14 lets
    /// it, as anywhere else; `unloaded` lists the glyphs it laid out from
    /// placeholders. Computed afresh on each call: a reader lays the page
    /// out again when a flag [`Self::page_layout_inputs`] lists changes.
    ///
    /// # Errors
    ///
    /// Returns [`PageLayoutError::NotAPage`] when the request's page is not
    /// a page of the scene.
    fn page_layout(&self, request: PageLayoutRequest) -> Result<PageLayout, PageLayoutError>;
    /// The flags whose change may change what [`Self::page_layout`]
    /// returns: the scene's, and what text layout reads.
    fn page_layout_inputs(&self) -> Vec<FontChangeFlag>;
    /// The features the session's shaper font defines, once per tag in tag
    /// order, each with the name it is shown by, what it does when text does
    /// not set it, and its group, as `shift_text::shape::Shaper::features` lists
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
    /// `shift_text::shape::Shaper::feature_substitutions` reads them from its
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
    /// Whether shaping text applies feature `tag` when a run turns it on or
    /// off (`on`, null when the run leaves it), as the run's layout sets it
    /// (`FeatureSetting::switch`): `FeatureDefault::applies` for the
    /// session's shaper font's feature: the setting wins, else its default.
    /// False for a tag the shaper font does not define. Changes when a flag
    /// in [`Self::shaper_inputs`] does.
    ///
    /// # Errors
    ///
    /// Returns [`FeatureListError`] when there is no shaper font, saying
    /// why, or it cannot be read.
    fn feature_applies(&self, tag: String, on: Option<bool>) -> Result<bool, FeatureListError>;
    /// What renaming `glyph` to `name` does: `Font::glyph_rename`. Null for a
    /// glyph the session's font lacks.
    fn glyph_rename(&self, glyph: GlyphId, name: String) -> Option<GlyphIdentityChange>;
    /// What making `codepoint` `glyph`'s primary codepoint does, or removing
    /// it with none: `Font::glyph_primary_codepoint`. Null for a glyph the
    /// session's font lacks.
    fn glyph_primary_codepoint(
        &self,
        glyph: GlyphId,
        codepoint: Option<u32>,
    ) -> Option<GlyphIdentityChange>;
    /// The linked sides of `glyph` in `source`, each with its key, where the
    /// key is set and why it cannot be applied: `Font::linked_sides`. Empty
    /// for a glyph or source the session's font lacks, or a glyph with no
    /// keys there.
    fn linked_sides(&self, glyph: GlyphId, source: SourceId) -> Vec<SideLink>;
    /// Why `text` is not a metrics key the session's font can read, or null
    /// when it is: `Font::metrics_key_problem`.
    fn metrics_key_problem(&self, text: String) -> Option<String>;
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
    /// Interns a compiled variation basis, as a compiled font's glyph carries
    /// its deltas, for [`Self::variation_at`], and returns its number. A
    /// number stays the basis's for the session's life.
    fn variation_number(&self, basis: VariationBasis) -> usize;
    /// The values of the compiled basis interned as `variation` at a design
    /// location, each axis normalized by its own range, over the session's
    /// axes: `VariationBasis::evaluate`.
    ///
    /// # Errors
    ///
    /// Returns [`CompiledVariationError::NotInterned`] for a number the
    /// session never gave, and [`CompiledVariationError::Unevaluable`] when
    /// the basis's regions name an axis the session lacks.
    fn variation_at(
        &self,
        variation: usize,
        location: Vec<f64>,
    ) -> Result<Vec<f64>, CompiledVariationError>;
    /// The document's pages, in list order.
    fn scene_pages(&self) -> Vec<SceneNode>;
    /// Every node of the document's scene, each root (pages first among
    /// them by index) then the nodes under it, each parent before its
    /// children, siblings in order.
    fn scene_nodes(&self) -> Vec<RevisedNode>;
    /// The nodes on `page`, each parent before its children, siblings in
    /// order; not the page itself. Empty for a page the scene lacks.
    fn page_nodes(&self, page: NodeId) -> Vec<SceneNode>;
    /// The node with `id`, on any page; null when the scene has none.
    fn scene_node(&self, id: NodeId) -> Option<SceneNode>;
    /// An external location's design location, through the font's axis
    /// mappings, exactly once: `map_location_with_bases`.
    fn design_location(&self, external: Vec<f64>) -> Vec<f64>;
    /// The external location a design location's mapping came from, NaN on
    /// internal axes: `unmap_location_with_bases`.
    fn external_location(&self, design: Vec<f64>) -> Vec<f64>;
    /// The `target` layer's ids for `points`, `anchors` and `components` in
    /// `reference`, each in the order given, as `Font::counterparts` pairs
    /// them, unsaved edits included; null when the layers don't match
    /// completely.
    ///
    /// # Errors
    ///
    /// Returns [`CounterpartsReadError::NotLoaded`] for a layer the session
    /// has not loaded, whose placeholder has no entities to match, and
    /// [`CounterpartsReadError::Font`] as `Font::counterparts` fails: an
    /// unknown layer, layers of two glyphs, or an id `reference` lacks.
    fn counterparts(
        &self,
        reference: LayerId,
        target: LayerId,
        points: Vec<PointId>,
        anchors: Vec<AnchorId>,
        components: Vec<ComponentId>,
    ) -> Result<Option<Counterparts>, CounterpartsReadError>;
    /// The font's records a store answers beside its axes, sources, kerning
    /// and glyph records: its metadata, metrics and metric rows, how source
    /// metrics interpolate, its axis mappings and their compiled bases, its
    /// named instances and its tracked languages, as the native workspace
    /// reads them from its font.
    ///
    /// # Errors
    ///
    /// Returns [`FontRecordsError`] when the font's axis mappings cannot be
    /// compiled.
    fn font_header(&self) -> Result<FontHeader, FontRecordsError>;
    /// Each of `glyphs`, then the glyphs their components use, transitively,
    /// each once: its projection (`Font::glyph_projection`) and its master
    /// layers, as the native workspace's glyph snapshots give them. A glyph
    /// the font lacks is left out.
    ///
    /// # Errors
    ///
    /// Returns [`FontRecordsError::NotLoaded`] for a glyph whose layers the
    /// session has not loaded (load its closure first), and
    /// [`FontRecordsError::Unprojectable`] when a projection cannot be built.
    fn glyph_snapshots(&self, glyphs: Vec<GlyphId>)
    -> Result<Vec<GlyphSnapshot>, FontRecordsError>;
}

/// The records [`EngineReads::font_header`] reads: what a font's store
/// answers at open besides its axes, sources, kerning and glyph records.
#[derive(Clone, Debug, Pack)]
pub struct FontHeader {
    pub metadata: FontMetadata,
    pub metrics: FontMetrics,
    pub metric_definitions: Vec<MetricDefinition>,
    pub source_metrics_interpolation: Option<SourceMetricsInterpolationSnapshot>,
    pub axis_mappings: Vec<AxisMapping>,
    pub axis_mapping_bases: Vec<AxisMappingBasis>,
    pub named_instances: Vec<NamedInstance>,
    /// Tracked Hyperglot language ids; `None` when the font stores no list.
    pub language_ids: Option<Vec<String>>,
}

/// Why [`EngineReads::variation_at`] could not evaluate a compiled basis.
/// Details are text: shift-font's errors cannot cross to the editor.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum CompiledVariationError {
    /// The session never interned a basis as `variation`.
    #[error("no compiled variation {variation} was interned")]
    NotInterned { variation: usize },
    /// The basis cannot be evaluated over the session's axes.
    #[error("the compiled variation cannot be evaluated: {detail}")]
    Unevaluable { detail: String },
}

/// Why [`EngineReads::font_header`] or [`EngineReads::glyph_snapshots`]
/// could not answer. Details are text: shift-font's errors cannot cross to
/// the editor.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum FontRecordsError {
    /// The session has not loaded `glyph`'s layers.
    #[error("glyph {glyph} is not loaded")]
    NotLoaded { glyph: GlyphId },
    /// The font's axis mappings cannot be compiled.
    #[error("the axis mappings cannot be compiled: {detail}")]
    Mappings { detail: String },
    /// A glyph's projection cannot be built.
    #[error("glyph {glyph} cannot be projected: {detail}")]
    Unprojectable { glyph: GlyphId, detail: String },
}

/// A text run to lay out, and where.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct TextLayoutRequest {
    /// The run's items and settings as the scene stores them, which Rust
    /// turns into layout options (`TextRun::layout_request`).
    pub run: TextRun,
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

#[cfg(feature = "engine")]
impl FeatureListError {
    /// The shaper font could not be read, for `error`.
    pub(crate) fn unreadable(error: impl std::fmt::Display) -> Self {
        Self::Unreadable {
            detail: error.to_string(),
        }
    }
}

/// Why [`EngineReads::counterparts`] could not answer.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum CounterpartsReadError {
    /// The session has not loaded `layer`; load its glyph first.
    #[error("layer {layer} is not loaded")]
    NotLoaded { layer: LayerId },
    /// The font could not match the layers.
    #[error(transparent)]
    Font {
        #[from]
        error: CounterpartsError,
    },
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
pub(crate) use exports::{CompiledVariations, FontVariation, InternedIds};

#[cfg(feature = "engine")]
mod exports {
    use std::cell::RefCell;
    use std::collections::{BTreeSet, HashMap, HashSet};
    use std::hash::Hash;
    use std::rc::Rc;

    use shift_engine::StoreReadError;
    use shift_font::ir::variation::{map_location_with_bases, unmap_location_with_bases};
    use shift_font::linked_metrics::SideLink;
    use shift_font::naming::new_anchor_name;
    use shift_font::wire::values::{self, WireParse};
    use shift_font::wire::{self as wire, GlyphLayerSnapshot, GlyphState};
    use shift_font::{
        AxisMapping, AxisMappingBasis, AxisRole, DesignLocation, ExternalLocation, Font,
        FontChangeImpact, FontCopyId, Glyph, GlyphId, GlyphRecords, InterpolationBasis, Kerning,
        KerningSide, Location, MissingKerningOrigin, ResolvedKerning, SourceId, VariationBasis,
    };
    use shift_text::layout::FeatureSetting;
    use wasm_bindgen::prelude::*;

    use super::{
        AnchorId, Axis, CompiledVariationError, ComponentId, Counterparts, CounterpartsReadError,
        EditablePair, EngineReads, FeatureListError, FeatureSubstitution, FontChangeFlag,
        FontFeature, FontHeader, FontRecordsError, GlyphIdentityChange, GlyphSnapshot,
        InterpolatedMetrics, KerningSnapshot, LayerId, LayoutError, NodeId, PageLayout,
        PageLayoutError, PageLayoutRequest, PlacedText, PointId, RevisedNode, SceneNode, Source,
        SourceSetWeights, TextLayoutRequest, engine_reads_request,
    };
    use crate::engine::{Engine, with_engine};
    use crate::page_layout::{PlaceKey, RunLayouts, lay_out_page};
    use crate::shaping::{TextPlace, TextShaping};

    /// The ids a session's reads name by number, each interned once.
    #[derive(Default)]
    pub(crate) struct InternedIds {
        glyphs: IdTable<GlyphId>,
        sources: IdTable<SourceId>,
        source_sets: IdTable<Vec<SourceId>>,
    }

    impl InternedIds {
        /// The source `font` has for the source the session interned as
        /// `number`; none for a number never interned or a source the font
        /// no longer has.
        fn source<'f>(&self, number: usize, font: &'f Font) -> Option<&'f Source> {
            font.source(*self.sources.get(number)?)
        }
    }

    /// The compiled variation bases a session interned, by number: the
    /// deltas a compiled font's glyphs carry, sent once each when the glyph
    /// loads and evaluated by number every frame after.
    #[derive(Default)]
    pub(crate) struct CompiledVariations(RefCell<Vec<VariationBasis>>);

    impl CompiledVariations {
        /// Keeps `basis` and returns its number.
        fn intern(&self, basis: VariationBasis) -> usize {
            let mut bases = self.0.borrow_mut();
            bases.push(basis);
            bases.len() - 1
        }

        /// The values of the basis numbered `number` at `location`, as
        /// numbers in `axes` order.
        ///
        /// # Errors
        ///
        /// As [`EngineReads::variation_at`].
        fn at(
            &self,
            number: usize,
            axes: &[Axis],
            location: &[f64],
        ) -> Result<Vec<f64>, CompiledVariationError> {
            let bases = self.0.borrow();
            let basis = bases
                .get(number)
                .ok_or(CompiledVariationError::NotInterned { variation: number })?;
            basis
                .evaluate(&to_location(axes, location), axes, None)
                .map_err(|error| CompiledVariationError::Unevaluable {
                    detail: error.to_string(),
                })
        }
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
            self.ids
                .sources
                .get(source)
                .map_or(MissingKerningOrigin::Unkerned, |source_id| {
                    self.session.font().missing_kerning_origin(*source_id)
                })
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
            let place = self.text_place(&request.location, request.source);
            let layout = self.shaping.layout_text(
                font,
                || self.shaper_font_source(),
                &request.run.layout_request(),
                place,
            )?;
            let unloaded = self.unloaded(font, layout.glyph_ids());
            Ok(PlacedText { layout, unloaded })
        }

        fn page_layout(&self, request: PageLayoutRequest) -> Result<PageLayout, PageLayoutError> {
            let font = self
                .previewed
                .as_ref()
                .unwrap_or_else(|| self.session.font());
            let place = self.text_place(&request.location, request.source);
            let units_per_em = font.metrics().units_per_em;
            let at = PlaceKey::new(&request.location, request.source);
            let mut runs = self.page_runs.borrow_mut();
            // A preview's font lays out once, keeping nothing.
            let mut previewed = RunLayouts::default();
            let kept = if self.previewed.is_some() {
                &mut previewed
            } else {
                &mut *runs
            };
            let (mut layout, glyphs) = self.shaping.with_layout_font(
                font,
                || self.shaper_font_source(),
                place,
                |layout_font| {
                    lay_out_page(
                        self.session.scene(),
                        &request.page,
                        units_per_em,
                        layout_font,
                        at,
                        kept,
                    )
                },
            )?;
            layout.unloaded = self.unloaded(font, glyphs);
            Ok(layout)
        }

        fn page_layout_inputs(&self) -> Vec<FontChangeFlag> {
            FontChangeFlag::of(TextShaping::LAYOUT_INPUTS.union(FontChangeImpact::SCENE)).collect()
        }

        fn glyph_rename(&self, glyph: GlyphId, name: String) -> Option<GlyphIdentityChange> {
            self.session.font().glyph_rename(glyph, &name).ok()
        }

        fn linked_sides(&self, glyph: GlyphId, source: SourceId) -> Vec<SideLink> {
            self.session.font().linked_sides(glyph, source)
        }

        fn metrics_key_problem(&self, text: String) -> Option<String> {
            self.session.font().metrics_key_problem(&text)
        }

        fn glyph_primary_codepoint(
            &self,
            glyph: GlyphId,
            codepoint: Option<u32>,
        ) -> Option<GlyphIdentityChange> {
            self.session
                .font()
                .glyph_primary_codepoint(glyph, codepoint)
                .ok()
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

        fn feature_applies(&self, tag: String, on: Option<bool>) -> Result<bool, FeatureListError> {
            self.shaping.feature_applies(
                self.session.font(),
                || self.shaper_font_source(),
                &tag,
                on.map(FeatureSetting::switch),
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

        fn variation_number(&self, basis: super::VariationBasis) -> usize {
            self.compiled.intern(basis.into())
        }

        fn variation_at(
            &self,
            variation: usize,
            location: Vec<f64>,
        ) -> Result<Vec<f64>, CompiledVariationError> {
            self.compiled
                .at(variation, self.session.font().axes(), &location)
        }

        fn design_location(&self, external: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            design_values(font.axes(), &self.variation().mappings, &external)
        }

        fn external_location(&self, design: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            external_values(font.axes(), &self.variation().mappings, &design)
        }

        fn scene_pages(&self) -> Vec<SceneNode> {
            self.session.scene().pages().cloned().collect()
        }

        fn scene_nodes(&self) -> Vec<RevisedNode> {
            self.session.scene().revised_nodes()
        }

        fn page_nodes(&self, page: NodeId) -> Vec<SceneNode> {
            self.session
                .scene()
                .descendants(&page)
                .into_iter()
                .cloned()
                .collect()
        }

        fn scene_node(&self, id: NodeId) -> Option<SceneNode> {
            self.session.scene().node(&id).cloned()
        }

        fn counterparts(
            &self,
            reference: LayerId,
            target: LayerId,
            points: Vec<PointId>,
            anchors: Vec<AnchorId>,
            components: Vec<ComponentId>,
        ) -> Result<Option<Counterparts>, CounterpartsReadError> {
            let residency = self.session.residency();
            if let Some(layer) = [reference, target]
                .into_iter()
                .find(|layer| residency.is_unloaded(*layer))
            {
                return Err(CounterpartsReadError::NotLoaded { layer });
            }
            Ok(self.session.font().counterparts(
                reference,
                target,
                &points,
                &anchors,
                &components,
            )?)
        }

        fn font_header(&self) -> Result<FontHeader, FontRecordsError> {
            let font = self.session.font();
            let axis_mapping_bases =
                font.axis_mapping_bases()
                    .map_err(|error| FontRecordsError::Mappings {
                        detail: error.to_string(),
                    })?;
            Ok(FontHeader {
                metadata: wire::FontMetadata::from(font.metadata()),
                metrics: wire::FontMetrics::from(font.metrics()),
                metric_definitions: font
                    .metric_definitions()
                    .iter()
                    .map(wire::MetricDefinition::from)
                    .collect(),
                source_metrics_interpolation: font
                    .source_metric_interpolation()
                    .as_ref()
                    .map(wire::SourceMetricsInterpolationSnapshot::from),
                axis_mappings: font
                    .axis_mappings()
                    .iter()
                    .map(wire::AxisMapping::from)
                    .collect(),
                axis_mapping_bases: axis_mapping_bases
                    .iter()
                    .map(wire::AxisMappingBasis::from)
                    .collect(),
                named_instances: font
                    .named_instances()
                    .iter()
                    .map(wire::NamedInstance::from)
                    .collect(),
                language_ids: font.language_ids(),
            })
        }

        fn glyph_snapshots(
            &self,
            glyphs: Vec<GlyphId>,
        ) -> Result<Vec<GlyphSnapshot>, FontRecordsError> {
            self.component_closure(glyphs)
                .into_iter()
                .filter_map(|glyph_id| {
                    let glyph = self.session.font().glyph(glyph_id)?;
                    Some(self.glyph_snapshot(glyph))
                })
                .collect()
        }
    }

    impl Engine {
        /// `roots`, then the glyphs their loaded layers' components draw,
        /// transitively, each once, in the order they were reached.
        fn component_closure(&self, roots: Vec<GlyphId>) -> Vec<GlyphId> {
            let font = self.session.font();
            let mut seen = HashSet::new();
            let mut closure = Vec::new();
            let mut frontier = roots;
            while !frontier.is_empty() {
                let reached: Vec<GlyphId> = frontier
                    .into_iter()
                    .filter(|glyph_id| seen.insert(*glyph_id))
                    .collect();
                frontier = font
                    .component_glyph_ids_of_glyphs(&reached)
                    .into_iter()
                    .collect();
                closure.extend(reached);
            }
            closure
        }

        /// `glyph`'s projection and master layers, as the native workspace's
        /// glyph snapshot gives them.
        fn glyph_snapshot(&self, glyph: &Glyph) -> Result<GlyphSnapshot, FontRecordsError> {
            let font = self.session.font();
            let glyph_id = glyph.id();
            let residency = self.session.residency();
            if glyph
                .layers()
                .keys()
                .any(|layer_id| residency.is_unloaded(*layer_id))
            {
                return Err(FontRecordsError::NotLoaded { glyph: glyph_id });
            }
            let projection = font.glyph_projection(glyph_id).map_err(|error| {
                FontRecordsError::Unprojectable {
                    glyph: glyph_id,
                    detail: error.to_string(),
                }
            })?;
            let layers = font
                .master_layers(glyph)
                .map(|layer| GlyphLayerSnapshot {
                    glyph_id,
                    source_id: layer.source_id(),
                    state: GlyphState::from_layer(layer),
                })
                .collect();
            Ok(GlyphSnapshot {
                glyph_id,
                projection: projection.as_ref().map(Into::into),
                layers,
            })
        }

        /// Of `glyphs`, those whose layers the session has not loaded in
        /// `font`.
        fn unloaded(&self, font: &Font, glyphs: BTreeSet<GlyphId>) -> Vec<GlyphId> {
            let residency = self.session.residency();
            glyphs
                .into_iter()
                .filter(|glyph| {
                    font.layer_ids_of_glyphs([glyph])
                        .into_iter()
                        .any(|layer| residency.is_unloaded(layer))
                })
                .collect()
        }

        /// Where text lays out: at `source`, when it names one the font has,
        /// otherwise at `location` mapped through the font's axis mappings;
        /// with the kerning there, none when it cannot be blended.
        fn text_place(&self, location: &[f64], source: Option<usize>) -> TextPlace {
            let font = self.session.font();
            let source = source.and_then(|number| self.ids.source(number, font));
            let external_of = |design: &[f64]| {
                let values = external_values(font.axes(), &self.variation().mappings, design);
                ExternalLocation::from_untyped(to_location(font.axes(), &values))
            };
            let Some(source) = source else {
                return TextPlace {
                    design: design_location(font, location),
                    external: external_of(location),
                    kerning: font
                        .kerning_blend_at(&design_location(font, location))
                        .unwrap_or_default(),
                };
            };
            let design = source.location().as_untyped().values_in(font.axes());
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

    /// `basis`'s weights at a design location given as numbers in `axes`
    /// order; zeros when `axes` lack an axis a region names.
    fn weights_at(basis: &InterpolationBasis, axes: &[Axis], location: &[f64]) -> Vec<f64> {
        let location = DesignLocation::from_untyped(to_location(axes, location));
        basis
            .weights_at(&location, axes)
            .unwrap_or_else(|_| vec![0.0; basis.source_ids().len()])
    }

    /// An external location's design location, both as numbers in `axes`
    /// order. When the mappings cannot be evaluated, external axes keep their
    /// values and internal ones take their defaults, as in an unmapped font.
    fn design_values(axes: &[Axis], mappings: &[AxisMappingBasis], external: &[f64]) -> Vec<f64> {
        let external = ExternalLocation::from_untyped(to_location(axes, external));
        match map_location_with_bases(&external, axes, mappings) {
            Ok(design) => design.as_untyped().values_in(axes),
            Err(_) => axes
                .iter()
                .map(|axis| match axis.role() {
                    AxisRole::External => external.value_on(axis),
                    AxisRole::Internal => axis.default(),
                })
                .collect(),
        }
    }

    /// The external location a design location's mapping came from, both as
    /// numbers in `axes` order, NaN on internal axes.
    fn external_values(axes: &[Axis], mappings: &[AxisMappingBasis], design: &[f64]) -> Vec<f64> {
        let design = DesignLocation::from_untyped(to_location(axes, design));
        unmap_location_with_bases(&design, axes, mappings)
            .as_untyped()
            .values_in(axes)
    }

    /// A location as numbers in `axes` order, NaN where it omits an axis.
    fn to_location(axes: &[Axis], values: &[f64]) -> Location {
        axes.iter()
            .zip(values)
            .filter(|(_, value)| !value.is_nan())
            .map(|(axis, value)| (axis.id(), *value))
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use shift_font::ir::variation::map_location;
        use shift_font::{
            AxisId, AxisMappingId, AxisMappingPoint, AxisSupport, Glyph, GlyphLayer,
            InterpolationRegion, LayerId, VariationDelta,
        };

        use super::*;
        use crate::engine::{engine_open_resident, engine_release};
        use shift_font::wire::VariationBasis as WireBasis;

        fn axis(
            id: &str,
            tag: &str,
            [minimum, default, maximum]: [f64; 3],
            role: AxisRole,
        ) -> Axis {
            let mut axis = Axis::continuous_with_id(
                AxisId::from_raw(id),
                tag.to_string(),
                tag.to_string(),
                minimum,
                default,
                maximum,
            );
            axis.set_role(role);
            axis
        }

        fn axes() -> Vec<Axis> {
            vec![
                axis(
                    "axis_weight",
                    "wght",
                    [100.0, 400.0, 900.0],
                    AxisRole::External,
                ),
                axis(
                    "axis_width",
                    "wdth",
                    [50.0, 100.0, 200.0],
                    AxisRole::External,
                ),
                axis(
                    "axis_optical",
                    "opsz",
                    [8.0, 12.0, 72.0],
                    AxisRole::Internal,
                ),
            ]
        }

        fn location(values: &[(&str, f64)]) -> Location {
            values
                .iter()
                .map(|(axis_id, value)| (AxisId::from_raw(*axis_id), *value))
                .collect()
        }

        /// Axis values by axis id.
        type Values<'a> = &'a [(&'a str, f64)];

        fn mapping(
            id: &str,
            inputs: &[&str],
            outputs: &[&str],
            points: &[(Values<'_>, Values<'_>)],
        ) -> AxisMapping {
            let ids = |ids: &[&str]| ids.iter().map(|id| AxisId::from_raw(*id)).collect();
            AxisMapping::with_id(
                AxisMappingId::from_raw(id),
                id.to_string(),
                ids(inputs),
                ids(outputs),
                points
                    .iter()
                    .map(|(input, output)| AxisMappingPoint {
                        description: None,
                        input: location(input),
                        output: location(output),
                    })
                    .collect(),
            )
        }

        fn weight_curve() -> AxisMapping {
            mapping(
                "axisMapping_weight",
                &["axis_weight"],
                &["axis_weight"],
                &[
                    (&[("axis_weight", 100.0)], &[("axis_weight", 100.0)]),
                    (&[("axis_weight", 400.0)], &[("axis_weight", 400.0)]),
                    (&[("axis_weight", 900.0)], &[("axis_weight", 800.0)]),
                ],
            )
        }

        fn reversed() -> AxisMapping {
            mapping(
                "axisMapping_reversed",
                &["axis_weight"],
                &["axis_weight"],
                &[
                    (&[("axis_weight", 100.0)], &[("axis_weight", 900.0)]),
                    (&[("axis_weight", 900.0)], &[("axis_weight", 100.0)]),
                ],
            )
        }

        fn optical_compensation() -> AxisMapping {
            mapping(
                "axisMapping_optical",
                &["axis_weight", "axis_width"],
                &["axis_optical"],
                &[(
                    &[("axis_weight", 800.0), ("axis_width", 125.0)],
                    &[("axis_optical", 72.0)],
                )],
            )
        }

        /// A resident session over a font with [`axes`] and `mappings`.
        struct Session(u32);

        impl Session {
            fn over(font: &Font) -> Self {
                let bytes = rmp_serde::to_vec_named(font).unwrap();
                Self(engine_open_resident(&bytes, None).unwrap())
            }

            fn mapped(mappings: Vec<AxisMapping>) -> Self {
                let mut font = Font::new();
                for axis in axes() {
                    font.add_axis(axis).unwrap();
                }
                font.set_axis_mappings(mappings).unwrap();
                Self::over(&font)
            }

            fn read<T>(&self, read: impl FnOnce(&Engine) -> T) -> T {
                with_engine(self.0, |engine| Ok(read(engine))).unwrap()
            }
        }

        impl Drop for Session {
            fn drop(&mut self) {
                engine_release(self.0);
            }
        }

        fn values(axes: &[Axis], location: &[(&str, f64)]) -> Vec<f64> {
            self::location(location).values_in(axes)
        }

        fn assert_close(actual: &[f64], expected: &[f64]) {
            assert_eq!(
                actual.len(),
                expected.len(),
                "{actual:?} against {expected:?}"
            );
            for (actual, expected) in actual.iter().zip(expected) {
                assert!(
                    (actual - expected).abs() < 1e-9,
                    "{actual} against {expected}"
                );
            }
        }

        #[test]
        fn maps_external_locations_as_fontdrasil_does() {
            let axes = axes();
            let cases = [
                (
                    vec![weight_curve()],
                    vec![("axis_weight", 650.0)],
                    600.0,
                    None,
                ),
                (vec![reversed()], vec![("axis_weight", 250.0)], 650.0, None),
                (
                    vec![weight_curve(), optical_compensation()],
                    vec![("axis_weight", 900.0), ("axis_width", 125.0)],
                    800.0,
                    Some(72.0),
                ),
            ];

            for (mappings, external, weight, optical) in cases {
                let session = Session::mapped(mappings);
                let design =
                    session.read(|engine| engine.design_location(values(&axes, &external)));

                assert_close(&design[..1], &[weight]);
                if let Some(optical) = optical {
                    assert_close(&design[2..], &[optical]);
                }
            }
        }

        #[test]
        fn maps_through_compiled_bases_as_through_authored_points() {
            let axes = axes();
            let sets = [
                vec![weight_curve()],
                vec![reversed()],
                vec![weight_curve(), optical_compensation()],
            ];
            for mappings in sets {
                let session = Session::mapped(mappings.clone());
                for step in 0..=8 {
                    let step = f64::from(step);
                    let external = [
                        ("axis_weight", 100.0 + 100.0 * step),
                        ("axis_width", 50.0 + 18.75 * step),
                    ];
                    let authored = map_location(
                        &ExternalLocation::from_untyped(location(&external)),
                        &axes,
                        &mappings,
                    )
                    .unwrap();
                    let expected: Vec<f64> = axes
                        .iter()
                        .map(|axis| {
                            authored
                                .as_untyped()
                                .get(axis.id())
                                .unwrap_or_else(|| axis.default())
                        })
                        .collect();

                    let design =
                        session.read(|engine| engine.design_location(values(&axes, &external)));

                    let design: Vec<f64> = axes
                        .iter()
                        .zip(design)
                        .map(|(axis, value)| {
                            if value.is_nan() {
                                axis.default()
                            } else {
                                value
                            }
                        })
                        .collect();
                    assert_close(&design, &expected);
                }
            }
        }

        #[test]
        fn recovers_the_external_controls_of_a_mapped_location() {
            let axes = axes();
            let session = Session::mapped(vec![weight_curve(), optical_compensation()]);
            let external = values(&axes, &[("axis_weight", 700.0), ("axis_width", 125.0)]);

            let recovered = session.read(|engine| {
                let design = engine.design_location(external.clone());
                engine.external_location(design)
            });

            assert_close(&recovered[..2], &external[..2]);
        }

        #[test]
        fn maps_an_atlas_location_once_before_weighing_its_sets() {
            let mut font = Font::new();
            let regular = font.default_source_id().unwrap();
            font.add_axis(axes().remove(0)).unwrap();
            let bold = font.add_source(Source::new(
                "Bold".to_string(),
                DesignLocation::from_untyped(location(&[("axis_weight", 800.0)])),
            ));
            font.set_axis_mappings(vec![weight_curve()]).unwrap();
            let session = Session::over(&font);

            let weights = with_engine(session.0, |engine| {
                let set = engine.ids.source_sets.intern_one(vec![regular, bold])?;
                let set = usize::try_from(set)?;
                // External 900 maps to design 800, Bold's location, once.
                Ok(engine.atlas_weights(vec![set], vec![900.0]))
            })
            .unwrap()
            .unwrap();

            assert_close(&weights, &[0.0, 1.0]);
        }

        #[test]
        fn evaluates_an_interned_compiled_basis_by_number() {
            let session = Session::mapped(Vec::new());
            let weight = AxisId::from_raw("axis_weight");
            let heavier = VariationBasis::new(vec![VariationDelta::new(
                InterpolationRegion::new(vec![AxisSupport::new(weight, 0.0, 1.0, 1.0)]),
                vec![10.0, -4.0],
            )]);
            let axes = axes();

            let [default, halfway, heaviest, missing] = session.read(|engine| {
                let number = engine.variation_number(WireBasis::from(&heavier));
                [
                    engine.variation_at(number, values(&axes, &[("axis_weight", 400.0)])),
                    engine.variation_at(number, values(&axes, &[("axis_weight", 650.0)])),
                    engine.variation_at(number, values(&axes, &[("axis_weight", 900.0)])),
                    engine.variation_at(number + 1, values(&axes, &[("axis_weight", 900.0)])),
                ]
            });

            assert_eq!(default, Ok(vec![0.0, 0.0]));
            assert_eq!(halfway, Ok(vec![5.0, -2.0]));
            assert_eq!(heaviest, Ok(vec![10.0, -4.0]));
            assert!(matches!(
                missing,
                Err(CompiledVariationError::NotInterned { .. })
            ));
        }

        #[test]
        fn a_resident_session_reads_every_glyph_without_a_store() {
            let mut font = Font::new();
            let source = font.default_source_id().unwrap();
            let mut glyph = Glyph::new("a");
            glyph.set_layer(GlyphLayer::with_width(LayerId::new(), source, 500.0));
            let glyph_id = glyph.id();
            font.insert_glyph(glyph).unwrap();
            let session = Session::over(&font);

            let (records, snapshots) = session.read(|engine| {
                (
                    engine.glyph_records().unwrap(),
                    engine.glyph_snapshots(vec![glyph_id]).unwrap(),
                )
            });

            assert_eq!(records.len(), 1);
            assert_eq!(snapshots.len(), 1);
            assert_eq!(snapshots[0].glyph_id, glyph_id);
        }
    }
}
