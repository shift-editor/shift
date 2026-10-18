//! Text shaping in the editor: shift-shape over the shaper font the
//! workspace compiled.
//!
//! The exports exist only with the `shaping` feature, which builds them into
//! `@shift/wasm/shaping`, a module of its own that the editor loads when
//! text first needs shaping. The layouts below are declared either way, so
//! the editor's side generates without the feature.
//!
//! This module is a separate instance from `@shift/wasm`, with its own name
//! table, so nothing here crosses as an interned name: units, locations, and
//! tags are numbers.

use crate::layout::layout;

layout! {
    /// How one shaper axis's user coordinates normalize, at each mapping point.
    pub struct ShaperAxis {
        pub user: Vec<f64>,
        pub normalized: Vec<f64>,
    }
}

layout! {
    /// A registered shaper's axes, in `fvar` order, and character mapping.
    pub struct ShaperGlyphs {
        pub shaper: usize,
        pub axes: Vec<ShaperAxis>,
        /// Characters as code points, each mapping to the shaper glyph at the same index of `glyphs`.
        pub codepoints: Vec<f64>,
        pub glyphs: Vec<f64>,
    }
}

layout! {
    /// A feature setting for every run of a paragraph.
    pub struct FeatureInput {
        /// The feature tag's four bytes, big-endian.
        pub tag: f64,
        /// `0` turns the feature off, `1` on; larger values pick an alternate.
        pub value: f64 => setting,
    }
}

layout! {
    /// One paragraph to shape.
    pub struct ParagraphInput {
        /// Each unit: a code point, or `-(glyph + 1)` for a glyph inserted by name as its shaper glyph id.
        pub units: Vec<f64>,
        /// The user coordinate on each shaper axis, in order; NaN for the axis default.
        pub location: Vec<f64>,
        /// A BCP 47 language tag as UTF-16 code units; empty for the default language system.
        pub language: Vec<f64>,
        pub features: Vec<FeatureInput>,
    }
}

layout! {
    /// Paragraphs to shape with one registered shaper.
    pub struct ShapeParagraphs {
        pub shaper: usize,
        pub paragraphs: Vec<ParagraphInput>,
    }
}

layout! {
    /// One shaped glyph, in font units.
    pub struct ShapedGlyphOutput {
        /// The shaper glyph; null for `.notdef`.
        pub glyph: Option<usize>,
        /// The paragraph unit the glyph's cluster starts at.
        pub cluster: usize,
        pub x_advance: f64,
        pub y_advance: f64,
        pub x_offset: f64,
        pub y_offset: f64,
    }
}

layout! {
    /// One run of a shaped paragraph, in logical order.
    pub struct ShapedRunOutput {
        /// The paragraph units the run covers, from `start` up to `end`.
        pub start: usize,
        pub end: usize,
        /// The run's ISO 15924 script tag's four bytes, big-endian; 0 when the run has no specific script.
        pub script: f64,
        pub right_to_left: bool,
        /// The run's glyphs in visual order.
        pub glyphs: Vec<ShapedGlyphOutput>,
    }
}

#[cfg(feature = "shaping")]
mod exports {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use shift_shape::{
        character_glyphs, AxisNormalization, FeatureSetting, GlyphSource, ParagraphRequest,
        ShapeError, Shaper, Tag, TextDirection, Unit, NOTDEF,
    };
    use wasm_bindgen::prelude::*;

    use super::{
        ParagraphInput, ShapeParagraphs, ShapedGlyphOutput, ShapedRunOutput, ShaperGlyphs,
    };
    use crate::layout::call;

    thread_local! {
        static SHAPERS: RefCell<Vec<Option<Registered>>> = const { RefCell::new(Vec::new()) };
    }

    /// A shaper font registered from the editor, and the editor's view of it.
    struct Registered {
        shaper: Shaper,
        glyphs: EditorGlyphs,
    }

    /// Glyphs as the editor names them, shaper glyph ids, with characters
    /// mapped from the live font and zero advances, which the editor
    /// replaces with live ones.
    #[derive(Default)]
    struct EditorGlyphs {
        characters: HashMap<u32, u32>,
        axes: Vec<AxisNormalization>,
    }

    impl GlyphSource for EditorGlyphs {
        type Glyph = u32;

        fn shaper_glyph(&self, glyph: &u32) -> Option<u32> {
            Some(*glyph)
        }

        fn host_glyph(&self, shaper_glyph: u32) -> Option<u32> {
            (shaper_glyph != NOTDEF).then_some(shaper_glyph)
        }

        fn character_glyph(&self, codepoint: u32) -> Option<u32> {
            self.characters.get(&codepoint).copied()
        }

        fn advance(&self, _shaper_glyph: u32) -> Option<i32> {
            Some(0)
        }
    }

    /// Registers a shaper font's bytes and returns its handle. Parses the
    /// font's layout tables once; set its glyphs with `setShaperGlyphs`.
    #[wasm_bindgen(js_name = registerShaper)]
    pub fn register_shaper(bytes: &[u8]) -> Result<u32, JsError> {
        let shaper = Shaper::new(bytes.to_vec())?;
        SHAPERS.with_borrow_mut(|shapers| {
            let handle = u32::try_from(shapers.len())?;
            shapers.push(Some(Registered {
                shaper,
                glyphs: EditorGlyphs::default(),
            }));
            Ok(handle)
        })
    }

    /// Releases a registered shaper; its handle shapes nothing afterwards.
    #[wasm_bindgen(js_name = releaseShaper)]
    pub fn release_shaper(handle: u32) {
        SHAPERS.with_borrow_mut(|shapers| {
            if let Some(slot) = usize::try_from(handle)
                .ok()
                .and_then(|index| shapers.get_mut(index))
            {
                *slot = None;
            }
        });
    }

    /// Input: `ShaperGlyphs`. Output: whether the shaper is registered.
    #[wasm_bindgen(js_name = setShaperGlyphs)]
    pub fn set_shaper_glyphs(input: &[f64]) -> Vec<f64> {
        call(input, |glyphs: ShaperGlyphs| {
            SHAPERS.with_borrow_mut(|shapers| {
                let Some(Some(registered)) = shapers.get_mut(glyphs.shaper) else {
                    return false;
                };
                registered.glyphs = EditorGlyphs {
                    characters: character_glyphs(
                        glyphs.codepoints.iter().zip(&glyphs.glyphs).filter_map(
                            |(&codepoint, &glyph)| Some((whole(codepoint)?, whole(glyph)?)),
                        ),
                    ),
                    axes: glyphs
                        .axes
                        .into_iter()
                        .map(|axis| {
                            AxisNormalization::new(
                                axis.user.into_iter().zip(axis.normalized).collect(),
                            )
                        })
                        .collect(),
                };
                true
            })
        })
    }

    /// Input: `ShapeParagraphs`. Output: each paragraph's runs, or null for
    /// a paragraph that cannot be shaped or an unregistered shaper.
    #[wasm_bindgen(js_name = shapeParagraphs)]
    pub fn shape_paragraphs(input: &[f64]) -> Vec<f64> {
        call(input, |request: ShapeParagraphs| {
            SHAPERS.with_borrow(|shapers| {
                let registered = shapers.get(request.shaper).and_then(Option::as_ref);
                request
                    .paragraphs
                    .iter()
                    .map(|paragraph| {
                        registered.and_then(|registered| shape(registered, paragraph).ok())
                    })
                    .collect::<Vec<_>>()
            })
        })
    }

    fn shape(
        registered: &Registered,
        paragraph: &ParagraphInput,
    ) -> Result<Vec<ShapedRunOutput>, ShapeError> {
        let units: Vec<Unit<u32>> = paragraph
            .units
            .iter()
            .filter_map(|&unit| unit_of(unit))
            .collect();
        let coords: Vec<_> = registered
            .glyphs
            .axes
            .iter()
            .enumerate()
            .map(|(index, axis)| axis.normalize(paragraph.location.get(index).copied()))
            .collect();
        let language = (!paragraph.language.is_empty()).then(|| {
            let code_units: Vec<u16> = paragraph
                .language
                .iter()
                .filter_map(|&unit| u16::try_from(whole(unit)?).ok())
                .collect();
            String::from_utf16_lossy(&code_units)
        });
        let features = paragraph
            .features
            .iter()
            .filter_map(|feature| {
                Some(FeatureSetting {
                    tag: Tag::new(&whole(feature.tag)?.to_be_bytes()),
                    value: whole(feature.value)?,
                })
            })
            .collect::<Vec<_>>();

        let runs = registered.shaper.shape_paragraph(
            &registered.glyphs,
            &ParagraphRequest {
                units: &units,
                location: coords.as_slice(),
                language: language.as_deref(),
                features: &features,
            },
        )?;
        Ok(runs
            .into_iter()
            .map(|run| ShapedRunOutput {
                start: index_of(run.units.start),
                end: index_of(run.units.end),
                script: run.script.as_deref().map_or(0.0, script_tag),
                right_to_left: run.direction == TextDirection::RightToLeft,
                glyphs: run
                    .glyphs
                    .into_iter()
                    .map(|glyph| ShapedGlyphOutput {
                        glyph: glyph.glyph_id.map(index_of),
                        cluster: index_of(glyph.cluster),
                        x_advance: f64::from(glyph.x_advance),
                        y_advance: f64::from(glyph.y_advance),
                        x_offset: f64::from(glyph.x_offset),
                        y_offset: f64::from(glyph.y_offset),
                    })
                    .collect(),
            })
            .collect())
    }

    /// Reads a unit: a code point, or `-(glyph + 1)` for an inserted glyph.
    fn unit_of(unit: f64) -> Option<Unit<u32>> {
        if unit < 0.0 {
            return whole(-unit - 1.0).map(Unit::Glyph);
        }
        char::from_u32(whole(unit)?).map(Unit::Character)
    }

    /// Returns `value` as a `u32` when it is a whole number in range.
    fn whole(value: f64) -> Option<u32> {
        let in_range = value.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(&value);
        // In range and whole, so the conversion is exact.
        in_range.then_some(value as u32)
    }

    fn index_of(value: u32) -> usize {
        usize::try_from(value).unwrap_or(usize::MAX)
    }

    /// Returns a script tag such as `Arab` as its four bytes, big-endian.
    fn script_tag(script: &str) -> f64 {
        let mut bytes = [b' '; 4];
        for (byte, source) in bytes.iter_mut().zip(script.bytes()) {
            *byte = source;
        }
        f64::from(u32::from_be_bytes(bytes))
    }
}
