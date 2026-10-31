//! Text shaping in the editor: shift-shape over a shaper font the editing
//! engine compiles from its own font (shift-shaper-font's fea-rs compile),
//! answered by [`EngineReads::shape_paragraphs`](crate::engine_reads::EngineReads::shape_paragraphs).
//!
//! The types are declared without features, so the editor's side generates
//! without building the engine; the shaper itself ([`TextShaping`]) exists
//! only with the `engine` feature, held by each session.

use pack::Pack;
use shift_font::{AxisId, GlyphId};

/// Why the session has no shaper to shape with. `detail` is the Rust error's
/// text; a paragraph it leaves unshaped carries it as its reason.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ShapingFailure {
    /// The font cannot make a shaper font, as for invalid units per em or
    /// axes, and none has been made before.
    #[error("{detail}")]
    Uncompilable { detail: String },
    /// The store's reader could not answer what the shaper font compiles from.
    #[error("{detail}")]
    Unreadable { detail: String },
}

/// One unit of text to shape.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum ShapeUnit {
    /// A Unicode scalar value.
    Character { codepoint: u32 },
    /// A glyph with no character to type, shaped as itself.
    Glyph { glyph_id: GlyphId },
}

/// A user-space coordinate on one axis.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct AxisCoordinate {
    pub axis_id: AxisId,
    pub value: f64,
}

/// A feature setting for every run of a paragraph.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct FeatureSetting {
    /// A feature tag such as `liga`.
    pub tag: String,
    /// `0` turns the feature off, `1` on; larger values pick an alternate.
    pub value: u32,
}

/// A paragraph to shape, split into runs of one script.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ParagraphRequest {
    pub units: Vec<ShapeUnit>,
    /// User-space location to shape at; axes left out are at their default.
    pub location: Vec<AxisCoordinate>,
    /// BCP 47 language tag; the default language system when null.
    pub language: Option<String>,
    /// Settings over the features applied by default.
    pub features: Vec<FeatureSetting>,
}

/// The direction a run's glyphs read in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Pack)]
pub enum TextDirection {
    #[default]
    Ltr,
    Rtl,
}

/// One shaped glyph. Advances and offsets hold only what the font's feature
/// code positions; glyph advances, kerning, and mark attachment are the
/// caller's to add.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ShapedGlyph {
    /// Null when a character has no glyph.
    pub glyph_id: Option<GlyphId>,
    /// Index of the first unit the glyph came from.
    pub cluster: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
    /// Whether `GDEF` classes the glyph as a mark.
    pub is_mark: bool,
}

/// A paragraph as shaping left it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum ShapedParagraph {
    /// Its runs, in logical order.
    Runs { runs: Vec<ShapedRun> },
    /// It could not be shaped, for `reason`, and lays out unshaped.
    Unshapable { reason: String },
}

/// One run of a shaped paragraph, in one script and direction.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct ShapedRun {
    /// First paragraph unit in the run.
    pub start: u32,
    /// One past the last paragraph unit in the run.
    pub end: u32,
    /// ISO 15924 script tag such as `Arab`; null when the run holds only
    /// characters common to all scripts.
    pub script: Option<String>,
    /// The run's resolved bidi level; odd levels read right to left.
    pub level: u32,
    pub direction: TextDirection,
    /// Glyphs in visual order; clusters index the paragraph's units.
    pub glyphs: Vec<ShapedGlyph>,
}

#[cfg(feature = "engine")]
pub(crate) use exports::{TextPlace, TextShaping};

#[cfg(feature = "engine")]
mod exports {
    use std::cell::RefCell;

    use shift_font::interpolation::KerningBlend;
    use shift_font::{
        DesignLocation, ExternalLocation, Font, FontChangeImpact, GlyphId, ShaperFontSource,
    };
    use shift_layout::{LayoutFont, LayoutRequest, LineMetrics, TextLayout};
    use shift_shape::{ShapeError, Tag, Unit};
    use shift_shaper_font::{LiveShaper, ShaperFontError, ShaperFontRequest, ShaperFontState};

    use super::{
        ParagraphRequest, ShapeUnit, ShapedGlyph, ShapedParagraph, ShapedRun, ShapingFailure,
        TextDirection,
    };

    /// A session's shaper: the shaper font compiled from the session's font,
    /// and a shaper over it that maps characters through the font's Unicode
    /// values. Built when text is first shaped, and brought up to date before
    /// the next shape after an edit that may have changed what it reads.
    ///
    /// Interior mutability lets reads, which borrow the session shared,
    /// bring it up to date.
    pub(crate) struct TextShaping {
        state: RefCell<ShaperState>,
    }

    struct ShaperState {
        /// Carries the last compilation forward: a source equal to it is not
        /// compiled again, and feature code with errors keeps its font.
        compilation: ShaperFontState,
        shaper: Option<LiveShaper>,
        /// Why there is no shaper, after the last try to make one failed.
        failure: Option<ShapingFailure>,
        /// Whether the session's font may have changed what the shaper reads
        /// since it was last brought up to date.
        stale: bool,
    }

    impl Default for TextShaping {
        fn default() -> Self {
            Self {
                state: RefCell::new(ShaperState {
                    compilation: ShaperFontState::default(),
                    shaper: None,
                    failure: None,
                    stale: true,
                }),
            }
        }
    }

    impl From<ShaperFontError> for ShapingFailure {
        fn from(error: ShaperFontError) -> Self {
            Self::Uncompilable {
                detail: error.to_string(),
            }
        }
    }

    impl From<ShapeError> for ShapingFailure {
        fn from(error: ShapeError) -> Self {
            Self::Uncompilable {
                detail: error.to_string(),
            }
        }
    }

    impl TextShaping {
        /// What a change with this impact may change of the shaper: the glyph
        /// directory (order, names, categories, Unicode values) and the axes
        /// and their mappings. Units per em and the feature source have no
        /// edit, so they change only when a session opens.
        pub(crate) const INPUTS: FontChangeImpact = FontChangeImpact::GLYPHS
            .union(FontChangeImpact::AXES.union(FontChangeImpact::AXIS_MAPPINGS));

        /// What a change with this impact may change of laid-out text: what
        /// the shaper reads, kerning, the source metrics lines are spaced by,
        /// and the glyph layers glyphs are placed from.
        pub(crate) const LAYOUT_INPUTS: FontChangeImpact = Self::INPUTS
            .union(FontChangeImpact::KERNING)
            .union(FontChangeImpact::SOURCE_METRICS)
            .union(FontChangeImpact::SOURCES)
            .union(FontChangeImpact::LAYERS);

        /// How many times the shaper font was compiled; a glyph change the
        /// compile does not read leaves it.
        #[cfg(test)]
        fn compiles(&self) -> u64 {
            self.state.borrow().compilation.compiles()
        }

        /// Brings the shaper up to date before the next shape when an edit
        /// with `impact` may have changed what it reads.
        pub(crate) fn forget_if_changed(&self, impact: FontChangeImpact) {
            if impact.intersects(Self::INPUTS) {
                self.state.borrow_mut().stale = true;
            }
        }

        /// Shapes paragraphs with the font's feature code, each into its
        /// runs, or unshapable with the reason.
        ///
        /// When the font may have changed since the last shape, `source`
        /// reads what the shaper font compiles from and the shaper is brought
        /// up to date first; an equal source is not compiled again. When no
        /// shaper can be made (the store's reader cannot answer, or the font
        /// cannot make a shaper font), every paragraph is unshapable for that
        /// reason until the next edit that may change it. Once a shaper has
        /// been made, a failure to update it keeps it, and it shapes as
        /// before.
        pub(crate) fn shape_paragraphs<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
            paragraphs: &[ParagraphRequest],
        ) -> Vec<ShapedParagraph> {
            let state = self.current(font, source);
            let shaper = match state.shaper() {
                Ok(shaper) => shaper,
                Err(reason) => {
                    return paragraphs
                        .iter()
                        .map(|_| ShapedParagraph::Unshapable {
                            reason: reason.clone(),
                        })
                        .collect();
                }
            };
            paragraphs
                .iter()
                .map(|paragraph| match shape(shaper, paragraph) {
                    Ok(runs) => ShapedParagraph::Runs { runs },
                    Err(error) => ShapedParagraph::Unshapable {
                        reason: error.to_string(),
                    },
                })
                .collect()
        }

        /// Lays `request` out over `font` at `place`, with the shaper brought
        /// up to date first as [`Self::shape_paragraphs`] does; text that
        /// cannot be shaped is laid out as typed, saying why.
        pub(crate) fn layout_text<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
            request: &LayoutRequest,
            place: TextPlace,
        ) -> TextLayout {
            let state = self.current(font, source);
            let class = |glyph| state.compilation.class(glyph);
            let layout_font = LayoutFont::new(
                font,
                &place.design,
                place.external,
                place.kerning,
                state.shaper(),
                &class,
                LineMetrics::at(font, &place.design),
            );
            TextLayout::new(&layout_font, request)
        }

        /// The shaper state, brought up to date with `font` when an edit may
        /// have changed what it reads.
        fn current<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
        ) -> std::cell::RefMut<'_, ShaperState> {
            let mut state = self.state.borrow_mut();
            if state.stale {
                state.stale = false;
                let updated = source()
                    .map_err(|error| ShapingFailure::Unreadable {
                        detail: error.to_string(),
                    })
                    .and_then(|source| state.update(font, &source));
                state.failure = updated.err().filter(|_| state.shaper.is_none());
            }
            state
        }
    }

    /// Where text is laid out: its design and user-space locations and the
    /// kerning there.
    pub(crate) struct TextPlace {
        pub(crate) design: DesignLocation,
        pub(crate) external: ExternalLocation,
        pub(crate) kerning: KerningBlend,
    }

    impl ShaperState {
        /// The shaper, or why there is none.
        fn shaper(&self) -> Result<&LiveShaper, String> {
            match (&self.shaper, &self.failure) {
                (Some(shaper), _) => Ok(shaper),
                (None, failure) => Err(failure
                    .as_ref()
                    .map_or_else(|| "no shaper font".to_string(), ToString::to_string)),
            }
        }

        /// Brings the compilation up to `source`, compiling only when
        /// something the compile reads changed, and maps characters through
        /// `font`'s Unicode values over the compilation's glyph order, which
        /// holds glyphs added since the last compile past the font's own.
        fn update(&mut self, font: &Font, source: &ShaperFontSource) -> Result<(), ShapingFailure> {
            let request = ShaperFontRequest::new(source)?;
            let font_changed = self.compilation.update(request)?;
            if font_changed || self.shaper.is_none() {
                let compiled = self.compilation.font().cloned().ok_or_else(|| {
                    ShapingFailure::Uncompilable {
                        detail: "the source compiled to no shaper font".to_string(),
                    }
                })?;
                self.shaper = Some(LiveShaper::new(compiled, font.character_map())?);
            }
            if let Some(shaper) = self.shaper.as_mut() {
                shaper.set_glyphs(self.compilation.glyph_order(), font.character_map());
            }
            Ok(())
        }
    }

    fn shape(
        shaper: &LiveShaper,
        paragraph: &ParagraphRequest,
    ) -> Result<Vec<ShapedRun>, ShapeError> {
        let units: Vec<Unit<GlyphId>> = paragraph
            .units
            .iter()
            .filter_map(|unit| match unit {
                ShapeUnit::Character { codepoint } => {
                    char::from_u32(*codepoint).map(Unit::Character)
                }
                ShapeUnit::Glyph { glyph_id } => Some(Unit::Glyph(*glyph_id)),
            })
            .collect();
        let location: ExternalLocation = paragraph
            .location
            .iter()
            .map(|coordinate| (coordinate.axis_id, coordinate.value))
            .collect();
        let features: Vec<_> = paragraph
            .features
            .iter()
            .filter_map(|feature| {
                Some(shift_shape::FeatureSetting {
                    tag: Tag::new_checked(feature.tag.as_bytes()).ok()?,
                    value: feature.value,
                })
            })
            .collect();
        let runs = shaper.shape_paragraph(&shift_shaper_font::ParagraphRequest {
            units: &units,
            location: &location,
            script: None,
            language: paragraph.language.as_deref(),
            features: &features,
        })?;
        Ok(runs
            .runs
            .into_iter()
            .map(|run| ShapedRun {
                start: run.units.start,
                end: run.units.end,
                script: run.script,
                level: u32::from(run.level),
                direction: match run.direction {
                    shift_shape::TextDirection::LeftToRight => TextDirection::Ltr,
                    shift_shape::TextDirection::RightToLeft => TextDirection::Rtl,
                },
                glyphs: run
                    .glyphs
                    .into_iter()
                    .map(|glyph| ShapedGlyph {
                        glyph_id: glyph.glyph_id,
                        cluster: glyph.cluster,
                        x_advance: glyph.x_advance,
                        y_advance: glyph.y_advance,
                        x_offset: glyph.x_offset,
                        y_offset: glyph.y_offset,
                        is_mark: glyph.is_mark,
                    })
                    .collect(),
            })
            .collect())
    }

    #[cfg(test)]
    mod tests {
        use std::convert::Infallible;

        use shift_font::{
            Font, FontChangeImpact, Glyph, GlyphClasses, GlyphDataCategory, ShaperFontSource,
        };

        use shift_font::interpolation::KerningBlend;
        use shift_font::{DesignLocation, ExternalLocation};
        use shift_layout::{LayoutRequest, LayoutUnit, TextLayout, TextOptions};

        use super::super::{ParagraphRequest, ShapeUnit, ShapedParagraph};
        use super::{TextPlace, TextShaping};

        const LIGATURE: &str = "feature liga { sub f i by f_i; } liga;";

        fn font_with(glyphs: &[(&str, Option<char>)]) -> Font {
            let mut font = Font::new();
            for (name, character) in glyphs {
                add(&mut font, name, *character);
            }
            font.features_mut()
                .set_fea_source(Some(LIGATURE.to_string()));
            font
        }

        fn add(font: &mut Font, name: &str, character: Option<char>) {
            let mut glyph = Glyph::new(name);
            if let Some(character) = character {
                glyph.add_unicode(u32::from(character));
            }
            font.insert_glyph(glyph).unwrap();
        }

        fn source(font: &Font) -> ShaperFontSource {
            let classes = GlyphClasses::of_loaded(font.glyphs(), font.lib(), |_| {
                GlyphDataCategory::default()
            });
            font.shaper_font_source(&classes)
        }

        /// Shapes `text` as one paragraph and names its glyphs.
        fn shaped(shaping: &TextShaping, font: &Font, text: &str) -> Vec<String> {
            let paragraph = ParagraphRequest {
                units: text
                    .chars()
                    .map(|character| ShapeUnit::Character {
                        codepoint: u32::from(character),
                    })
                    .collect(),
                location: Vec::new(),
                language: None,
                features: Vec::new(),
            };
            let shaped =
                shaping.shape_paragraphs(font, || Ok::<_, Infallible>(source(font)), &[paragraph]);
            let [ShapedParagraph::Runs { runs }] = shaped.as_slice() else {
                panic!("the paragraph did not shape: {shaped:?}");
            };
            let glyphs = runs.iter().flat_map(|run| &run.glyphs);
            glyphs
                .map(|glyph| {
                    font.glyph(glyph.glyph_id.unwrap())
                        .unwrap()
                        .name()
                        .to_string()
                })
                .collect()
        }

        fn edited(shaping: &TextShaping) {
            shaping.forget_if_changed(FontChangeImpact::GLYPHS);
        }

        #[test]
        fn a_glyph_the_features_do_not_name_shapes_without_a_recompile() {
            let mut font = font_with(&[("f", Some('f')), ("i", Some('i')), ("f_i", None)]);
            let shaping = TextShaping::default();
            assert_eq!(shaped(&shaping, &font, "fi"), ["f_i"]);
            assert_eq!(shaping.compiles(), 1);

            add(&mut font, "x", Some('x'));
            edited(&shaping);

            assert_eq!(shaped(&shaping, &font, "fix"), ["f_i", "x"]);
            assert_eq!(shaping.compiles(), 1);
        }

        #[test]
        fn adding_or_renaming_a_glyph_the_features_name_recompiles() {
            let mut font = font_with(&[("f", Some('f')), ("i", Some('i'))]);
            let shaping = TextShaping::default();
            assert_eq!(shaped(&shaping, &font, "fi"), ["f", "i"]);
            let first = shaping.compiles();

            add(&mut font, "f_i", None);
            edited(&shaping);
            assert_eq!(shaped(&shaping, &font, "fi"), ["f_i"]);
            assert_eq!(shaping.compiles(), first + 1);

            let ligature = font.glyph_by_name("f_i").unwrap().id();
            font.rename_glyph(ligature, "f_i.liga".into()).unwrap();
            edited(&shaping);
            // The source no longer compiles, so the last font shapes on.
            assert_eq!(shaped(&shaping, &font, "fi"), ["f_i.liga"]);
            assert_eq!(shaping.compiles(), first + 2);
        }

        fn laid_out(
            shaping: &TextShaping,
            font: &Font,
            text: &str,
            shaping_on: bool,
        ) -> TextLayout {
            let request = LayoutRequest {
                units: text
                    .chars()
                    .map(|character| LayoutUnit::Character {
                        codepoint: u32::from(character),
                    })
                    .collect(),
                options: TextOptions {
                    shaping: shaping_on,
                    ..TextOptions::default()
                },
            };
            let place = TextPlace {
                design: DesignLocation::new(),
                external: ExternalLocation::new(),
                kerning: KerningBlend::default(),
            };
            shaping.layout_text(font, || Ok::<_, Infallible>(source(font)), &request, place)
        }

        #[test]
        fn text_lays_out_with_the_session_s_shaper_or_as_typed() {
            let font = font_with(&[("f", Some('f')), ("i", Some('i')), ("f_i", None)]);
            let shaping = TextShaping::default();

            let shaped = laid_out(&shaping, &font, "fi", true);
            let typed = laid_out(&shaping, &font, "fi", false);

            let ligature = font.glyph_by_name("f_i").unwrap().id();
            assert_eq!(shaped.glyphs.len(), 1);
            assert_eq!(shaped.glyphs[0].glyph_id, Some(ligature));
            assert_eq!(typed.glyphs.len(), 2);
            assert_eq!(shaped.carets.len(), 3);
            assert_eq!(shaping.compiles(), 1);
        }
    }
}
