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
//! The session builds each interned source set's interpolation basis, and the
//! font's axis mappings, when a read first needs them, and drops them when an
//! edit changes the axes, mappings or sources they were built from.

use pack::Pack;
use shift_engine::StoreReadError;
use shift_font::{Axis, GlyphRecord, MetricValue, MissingKerningOrigin, ResolvedKerning, Source};
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
    fn glyph_records(&self) -> Result<Vec<GlyphRecord>, StoreReadError>;
    /// One weight per source of the interned source set `set`, in its order,
    /// at a design location, from the basis the session's font gives that
    /// set: `InterpolationBasis::weights_at`. Empty for a set the session
    /// never interned, or one whose sources the font lacks or that forms no
    /// model.
    fn interpolation_weights(&self, set: usize, location: Vec<f64>) -> Vec<f64>;
    /// The weights of the interned source sets `sets`, as
    /// [`EngineReads::interpolation_weights`] gives each, one set after
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

#[cfg(feature = "engine")]
pub(crate) use exports::{InternedIds, VariationCache};

#[cfg(feature = "engine")]
mod exports {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::hash::Hash;
    use std::rc::Rc;

    use shift_engine::StoreReadError;
    use shift_font::naming::new_anchor_name;
    use shift_font::{
        AxisMappingBasis, DesignLocation, Font, FontChangeImpact, GlyphId, GlyphRecord,
        InterpolationBasis, Kerning, KerningSide, LayerId, MissingKerningOrigin, ResolvedKerning,
        SourceId,
    };
    use shift_wire::values::{self, WireParse};
    use wasm_bindgen::prelude::*;

    use super::{
        Axis, EditablePair, EngineReads, InterpolatedMetrics, KerningSnapshot, Source,
        engine_reads_request,
    };
    use crate::engine::{Engine, with_engine};
    use crate::variation::{design_values, external_values, to_location, weights_at};

    /// The ids a session's reads name by number, each interned once.
    #[derive(Default)]
    pub(crate) struct InternedIds {
        glyphs: IdTable<GlyphId>,
        sources: IdTable<SourceId>,
        source_sets: IdTable<Vec<SourceId>>,
    }

    /// What the variation reads evaluate, built from the session's font when
    /// first read: each interned source set's basis, by set number, and the
    /// font's axis mappings. Interior mutability lets reads, which borrow the
    /// session shared, fill it.
    #[derive(Default)]
    pub(crate) struct VariationCache {
        bases: RefCell<HashMap<usize, Option<Rc<InterpolationBasis>>>>,
        mappings: RefCell<Option<Rc<Vec<AxisMappingBasis>>>>,
    }

    impl VariationCache {
        /// What an edit with `impact` changed the inputs of is dropped.
        pub(crate) fn forget_if_changed(&self, impact: FontChangeImpact) {
            let inputs = FontChangeImpact::AXES
                | FontChangeImpact::AXIS_MAPPINGS
                | FontChangeImpact::AXIS_MAPPING_BASES
                | FontChangeImpact::SOURCES;
            if impact.intersects(inputs) {
                self.forget();
            }
        }

        /// Drops everything, as when the session goes back to an earlier font.
        pub(crate) fn forget(&self) {
            self.bases.borrow_mut().clear();
            self.mappings.borrow_mut().take();
        }

        /// The basis of the interned set `set`, built from `font` on first use.
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

        /// The font's compiled axis mappings, built on first use; none when
        /// they cannot be compiled, which maps as an unmapped font does.
        fn mappings(&self, font: &Font) -> Rc<Vec<AxisMappingBasis>> {
            let mut mappings = self.mappings.borrow_mut();
            let mappings = mappings
                .get_or_insert_with(|| Rc::new(font.axis_mapping_bases().unwrap_or_default()));
            Rc::clone(mappings)
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

        fn glyph_records(&self) -> Result<Vec<GlyphRecord>, StoreReadError> {
            Self::glyph_records(self)
        }

        fn interpolation_weights(&self, set: usize, location: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            match self.variation.basis(set, font, &self.ids) {
                Some(basis) => weights_at(&basis, font.axes(), &location),
                None => Vec::new(),
            }
        }

        fn atlas_weights(&self, sets: Vec<usize>, external: Vec<f64>) -> Option<Vec<f64>> {
            let font = self.session.font();
            let design = design_values(font.axes(), &self.variation.mappings(font), &external);
            let mut weights = Vec::new();
            for set in sets {
                let basis = self.variation.basis(set, font, &self.ids)?;
                weights.extend(weights_at(&basis, font.axes(), &design));
            }
            Some(weights)
        }

        fn design_location(&self, external: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            design_values(font.axes(), &self.variation.mappings(font), &external)
        }

        fn external_location(&self, design: Vec<f64>) -> Vec<f64> {
            let font = self.session.font();
            external_values(font.axes(), &self.variation.mappings(font), &design)
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
