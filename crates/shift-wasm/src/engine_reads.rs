//! What the editor reads from the editing engine's font: kerning and source
//! metrics, answered by the same shift-font code the workspace and export run.
//!
//! The [`EngineReads`] interface is answered only with the `engine` feature,
//! beside the session it reads ([`crate::engine`]). The interface and its
//! types are declared either way, so the editor's side generates without the
//! feature.
//!
//! The engine is a separate instance from `@shift/wasm`, with no name table of
//! its own, so ids cross as numbers the session interns: the editor interns a
//! glyph or source id once with `engineGlyphNumbers` or `engineSourceNumbers`
//! and passes its number from then on. A location crosses as numbers in the
//! font's axis order, NaN for an axis at its default.

use pack::Pack;
use shift_font::MetricValue;

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
pub(crate) use exports::InternedIds;

#[cfg(feature = "engine")]
mod exports {
    use std::collections::HashMap;
    use std::hash::Hash;

    use serde::Serialize;
    use shift_font::naming::new_anchor_name;
    use shift_font::{
        DesignLocation, Font, GlyphId, Kerning, KerningSide, LayerId, ResolvedKerning, SourceId,
    };
    use shift_wire::values::{self, WireParse};
    use tsify::{Ts, Tsify};
    use wasm_bindgen::prelude::*;

    use super::{EditablePair, EngineReads, InterpolatedMetrics, engine_reads_request};
    use crate::engine::{Engine, with_engine};
    use crate::variation::to_location;

    /// The ids a session's reads name by number, each interned once.
    #[derive(Default)]
    pub(crate) struct InternedIds {
        glyphs: IdTable<GlyphId>,
        sources: IdTable<SourceId>,
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
                .map(|id| {
                    if let Some(number) = self.numbers.get(&id) {
                        return Ok(*number);
                    }
                    let number = u32::try_from(self.ids.len())?;
                    self.ids.push(id.clone());
                    self.numbers.insert(id, number);
                    Ok(number)
                })
                .collect()
        }
    }

    impl<T: Copy> IdTable<T> {
        fn get(&self, number: usize) -> Option<&T> {
            self.ids.get(number)
        }

        /// The id interned as `number`.
        ///
        /// # Errors
        ///
        /// Fails when the session interned no id as `number`.
        fn require(&self, number: u32) -> Result<T, JsError> {
            usize::try_from(number)
                .ok()
                .and_then(|number| self.get(number))
                .copied()
                .ok_or_else(|| JsError::new(&format!("no id was interned as {number}")))
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

    /// An authored pair, its sides by id, and its value at a source.
    #[derive(Serialize, Tsify)]
    pub struct EngineKerningPair {
        #[tsify(type = "GlyphId | KerningGroupId")]
        first: String,
        #[tsify(type = "GlyphId | KerningGroupId")]
        second: String,
        /// Font units added after the first glyph's advance.
        amount: f64,
    }

    impl From<ResolvedKerning> for EngineKerningPair {
        fn from(resolved: ResolvedKerning) -> Self {
            Self {
                first: side_id(&resolved.pair.first),
                second: side_id(&resolved.pair.second),
                amount: resolved.value,
            }
        }
    }

    fn side_id(side: &KerningSide) -> String {
        match side {
            KerningSide::Glyph(glyph_id) => glyph_id.to_string(),
            KerningSide::Group(group_id) => group_id.to_string(),
        }
    }

    /// Authored pairs, in the order the read returns them.
    #[derive(Serialize, Tsify)]
    #[serde(transparent)]
    pub struct EngineKerningPairs(Vec<EngineKerningPair>);

    /// The pairs authored at a source that name a glyph on a side, directly or
    /// through its group at that side, as `Kerning::pairs_naming` finds them.
    /// The source and glyph are numbers the session interned.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle, or a number the session never interned.
    #[wasm_bindgen(js_name = engineKerningPairsNaming)]
    pub fn engine_kerning_pairs_naming(
        handle: u32,
        source: u32,
        glyph: u32,
    ) -> Result<Ts<EngineKerningPairs>, JsError> {
        let pairs = with_engine(handle, |engine| {
            let source_id = engine.ids.sources.require(source)?;
            let glyph_id = engine.ids.glyphs.require(glyph)?;
            let kerning = engine.session.font().kerning();
            Ok(EngineKerningPairs(
                kerning
                    .pairs_naming(source_id, glyph_id)
                    .map(EngineKerningPair::from)
                    .collect(),
            ))
        })?;
        Ok(pairs.into_ts()?)
    }

    /// Where a pair's value comes from at a source that authors no pair for it.
    #[derive(Serialize, Tsify)]
    #[serde(rename_all = "lowercase")]
    pub enum MissingKerningOrigin {
        /// The source kerns on its own, or is the font's only one: the pair kerns zero.
        Unkerned,
        /// The pair's value blends the sources that author kerning.
        Interpolated,
    }

    impl From<shift_font::MissingKerningOrigin> for MissingKerningOrigin {
        fn from(origin: shift_font::MissingKerningOrigin) -> Self {
            match origin {
                shift_font::MissingKerningOrigin::Unkerned => Self::Unkerned,
                shift_font::MissingKerningOrigin::Interpolated => Self::Interpolated,
            }
        }
    }

    /// Where a pair's value comes from at a source, by number, that authors
    /// no pair for it: `Font::missing_kerning_origin`.
    ///
    /// # Errors
    ///
    /// Fails on an unknown handle, or a number the session never interned.
    #[wasm_bindgen(js_name = engineMissingKerningOrigin)]
    pub fn engine_missing_kerning_origin(
        handle: u32,
        source: u32,
    ) -> Result<Ts<MissingKerningOrigin>, JsError> {
        let origin = with_engine(handle, |engine| {
            let source_id = engine.ids.sources.require(source)?;
            Ok(MissingKerningOrigin::from(
                engine.session.font().missing_kerning_origin(source_id),
            ))
        })?;
        Ok(origin.into_ts()?)
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
