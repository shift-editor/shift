//! Text layout in the editor: shift-layout over the session's font and a
//! shaper font the editing engine compiles from it (shift-shaper-font's
//! fea-rs compile), answered by
//! [`EngineReads::layout_text`](crate::engine_reads::EngineReads::layout_text).
//!
//! The shaper itself ([`TextShaping`]) exists only with the `engine`
//! feature, held by each session.

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

#[cfg(feature = "engine")]
pub(crate) use exports::{TextPlace, TextShaping};

#[cfg(feature = "engine")]
mod exports {
    use std::cell::RefCell;

    use shift_font::interpolation::KerningBlend;
    use shift_font::{DesignLocation, ExternalLocation, Font, FontChangeImpact, ShaperFontSource};
    use shift_layout::{LayoutError, LayoutFont, LayoutRequest, LineMetrics, TextLayout};
    use shift_shape::ShapeError;
    use shift_shaper_font::{LiveShaper, ShaperFontError, ShaperFontRequest, ShaperFontState};

    use super::ShapingFailure;
    use crate::engine_reads::{FeatureSubstitution, FontFeature};

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

        /// Lays `request` out over `font` at `place`, with the shaper brought
        /// up to date first; text that cannot be shaped is laid out as typed,
        /// saying why.
        ///
        /// When the font may have changed since the last layout, `source`
        /// reads what the shaper font compiles from and the shaper is brought
        /// up to date first; an equal source is not compiled again. When no
        /// shaper can be made (the store's reader cannot answer, or the font
        /// cannot make a shaper font), text lays out as typed for that reason
        /// until the next edit that may change it. Once a shaper has been
        /// made, a failure to update it keeps it, and it shapes as before.
        ///
        /// # Errors
        ///
        /// Returns [`LayoutError::TooLong`] for text too long to index.
        pub(crate) fn layout_text<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
            request: &LayoutRequest,
            place: TextPlace,
        ) -> Result<TextLayout, LayoutError> {
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

        /// The features the shaper font defines, in tag order, with the
        /// shaper brought up to date first as for [`Self::layout_text`];
        /// empty when there is no shaper or its font cannot be read.
        pub(crate) fn features<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
        ) -> Vec<FontFeature> {
            let state = self.current(font, source);
            let Ok(shaper) = state.shaper() else {
                return Vec::new();
            };
            shaper.features().unwrap_or_default()
        }

        /// Every substitution feature `tag` can make in the shaper font, with
        /// the shaper brought up to date first as for [`Self::layout_text`];
        /// empty for an invalid tag or no shaper, and `None` when the shaper
        /// font's `GSUB` cannot be read.
        pub(crate) fn feature_substitutions<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
            tag: &str,
        ) -> Option<Vec<FeatureSubstitution>> {
            let Ok(tag) = shift_shape::Tag::new_checked(tag.as_bytes()) else {
                return Some(Vec::new());
            };
            let state = self.current(font, source);
            let Ok(shaper) = state.shaper() else {
                return Some(Vec::new());
            };
            let rules = shaper.feature_substitutions(tag).ok()?;
            Some(
                rules
                    .into_iter()
                    .map(|rule| FeatureSubstitution {
                        input: rule.input,
                        output: rule.output,
                    })
                    .collect(),
            )
        }

        /// Whether shaping applies feature `tag` when text sets it to
        /// `setting`, as `FeatureDefault::applies` decides for the shaper
        /// font's feature, with the shaper brought up to date first as for
        /// [`Self::layout_text`]; false for a tag the shaper font does not
        /// define, an unreadable font, or no shaper.
        pub(crate) fn feature_applies<E: std::fmt::Display>(
            &self,
            font: &Font,
            source: impl FnOnce() -> Result<ShaperFontSource, E>,
            tag: &str,
            setting: Option<u32>,
        ) -> bool {
            let state = self.current(font, source);
            let Ok(shaper) = state.shaper() else {
                return false;
            };
            shaper
                .features()
                .unwrap_or_default()
                .iter()
                .find(|feature| feature.tag == tag)
                .is_some_and(|feature| feature.default.applies(setting))
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

    #[cfg(test)]
    mod tests {
        use std::convert::Infallible;

        use shift_font::{
            Font, FontChangeImpact, Glyph, GlyphClasses, GlyphDataCategory, ShaperFontSource,
        };

        use shift_font::interpolation::KerningBlend;
        use shift_font::{DesignLocation, ExternalLocation};
        use shift_layout::{LayoutRequest, LayoutUnit, TextLayout, TextOptions};

        use super::{TextPlace, TextShaping};
        use crate::engine_reads::{FeatureDefault, FeatureGroup, FeatureSubstitution, FontFeature};

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

        /// Lays `text` out shaped and names its glyphs.
        fn shaped(shaping: &TextShaping, font: &Font, text: &str) -> Vec<String> {
            let laid_out = laid_out(shaping, font, text, true);
            assert_eq!(laid_out.unshaped, None);
            laid_out
                .glyphs
                .iter()
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
            shaping
                .layout_text(font, || Ok::<_, Infallible>(source(font)), &request, place)
                .unwrap()
        }

        #[test]
        fn features_list_the_shaper_font_s_with_their_names_and_defaults() {
            let font = font_with(&[("f", Some('f')), ("i", Some('i')), ("f_i", None)]);
            let shaping = TextShaping::default();

            let features = shaping.features(&font, || Ok::<_, Infallible>(source(&font)));

            assert_eq!(
                features,
                [FontFeature {
                    tag: "liga".to_string(),
                    name: Some("Standard Ligatures".to_string()),
                    default: FeatureDefault::On,
                    group: FeatureGroup::Ligatures,
                }]
            );
        }

        #[test]
        fn substitutions_list_what_a_feature_brings_in_by_glyph_id() {
            let font = font_with(&[("f", Some('f')), ("i", Some('i')), ("f_i", None)]);
            let shaping = TextShaping::default();
            let id = |name: &str| font.glyph_by_name(name).unwrap().id();
            let read = |tag: &str| {
                shaping.feature_substitutions(&font, || Ok::<_, Infallible>(source(&font)), tag)
            };

            assert_eq!(
                read("liga"),
                Some(vec![FeatureSubstitution {
                    input: vec![id("f"), id("i")],
                    output: id("f_i"),
                }])
            );
            assert_eq!(read("li"), Some(Vec::new()));
        }

        #[test]
        fn a_feature_applies_as_the_text_sets_it_over_its_default() {
            let font = font_with(&[("f", Some('f')), ("i", Some('i')), ("f_i", None)]);
            let shaping = TextShaping::default();
            let applies = |tag: &str, setting: Option<u32>| {
                shaping.feature_applies(&font, || Ok::<_, Infallible>(source(&font)), tag, setting)
            };

            assert!(applies("liga", None));
            assert!(!applies("liga", Some(0)));
            // A tag the font does not define never applies.
            assert!(!applies("ss01", Some(1)));
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
