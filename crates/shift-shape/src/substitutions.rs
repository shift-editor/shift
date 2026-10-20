//! The substitutions a feature can make, read from the font's `GSUB`.

use crate::{GlyphSource, ShapeError, Shaper};

/// One substitution a feature can make: `input` in the text becomes `output`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Substitution<G> {
    /// The glyphs replaced; more than one for a ligature.
    pub input: Vec<G>,
    pub output: G,
}

impl Shaper {
    /// Returns every substitution a feature can make, ordered by output glyph
    /// then input: each rule of each lookup the feature reaches, lookups that
    /// contextual rules call included, whether or not its input is a glyph the
    /// font maps a character to. A rule with several outputs, such as a
    /// multiple substitution or a set of alternates, gives one substitution
    /// per output. Glyphs `source` has no glyph for, such as `.notdef`, drop
    /// the substitutions they appear in.
    ///
    /// Empty for a positioning feature, or a tag the font does not define.
    ///
    /// # Errors
    ///
    /// Returns [`ShapeError::InvalidFont`] when the font's `GSUB` cannot be
    /// read.
    pub fn feature_substitutions<S: GlyphSource>(
        &self,
        source: &S,
        tag: &str,
    ) -> Result<Vec<Substitution<S::Glyph>>, ShapeError> {
        use skrifa::raw::TableProvider;
        use skrifa::raw::collections::IntSet;
        use skrifa::raw::tables::gsub::{SingleSubst, SubstitutionSubtables};
        use skrifa::raw::types::GlyphId as RawGlyphId;

        let invalid = |_| ShapeError::InvalidFont;
        let font = skrifa::raw::FontRef::new(self.bytes()).map_err(invalid)?;
        let Ok(gsub) = font.gsub() else {
            return Ok(Vec::new());
        };
        let mut features = IntSet::<u16>::empty();
        for (index, record) in gsub
            .feature_list()
            .map_err(invalid)?
            .feature_records()
            .iter()
            .enumerate()
        {
            if record.feature_tag() == tag {
                features.insert(u16::try_from(index).map_err(|_| ShapeError::InvalidFont)?);
            }
        }
        if features.is_empty() {
            return Ok(Vec::new());
        }
        let lookup_list = gsub.lookup_list().map_err(invalid)?;
        let mut lookups = gsub.collect_lookups(&features).map_err(invalid)?;
        let mut every_glyph = IntSet::<RawGlyphId>::empty();
        every_glyph.invert();
        lookup_list
            .closure_lookups(&every_glyph, &mut lookups)
            .map_err(invalid)?;

        // Shaper glyph ids: (output, input sequence).
        let mut rules = std::collections::BTreeSet::<(u32, Vec<u32>)>::new();
        let mut add = |input: Vec<u32>, output: u32| {
            rules.insert((output, input));
        };
        for index in lookups.iter() {
            let lookup = lookup_list
                .lookups()
                .get(usize::from(index))
                .map_err(invalid)?;
            match lookup.subtables().map_err(invalid)? {
                SubstitutionSubtables::Single(subtables) => {
                    for subtable in subtables.iter() {
                        match subtable.map_err(invalid)? {
                            SingleSubst::Format1(table) => {
                                let delta = i32::from(table.delta_glyph_id());
                                for glyph in table.coverage().map_err(invalid)?.iter() {
                                    // The delta wraps modulo 65536.
                                    let output =
                                        (i32::from(glyph.to_u16()) + delta).rem_euclid(1 << 16);
                                    add(vec![glyph.to_u32()], output.unsigned_abs());
                                }
                            }
                            SingleSubst::Format2(table) => {
                                let coverage = table.coverage().map_err(invalid)?;
                                for (glyph, output) in
                                    coverage.iter().zip(table.substitute_glyph_ids())
                                {
                                    add(vec![glyph.to_u32()], output.get().to_u32());
                                }
                            }
                        }
                    }
                }
                SubstitutionSubtables::Multiple(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (glyph, sequence) in coverage.iter().zip(subtable.sequences().iter()) {
                            for output in sequence.map_err(invalid)?.substitute_glyph_ids() {
                                add(vec![glyph.to_u32()], output.get().to_u32());
                            }
                        }
                    }
                }
                SubstitutionSubtables::Alternate(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (glyph, set) in coverage.iter().zip(subtable.alternate_sets().iter()) {
                            for output in set.map_err(invalid)?.alternate_glyph_ids() {
                                add(vec![glyph.to_u32()], output.get().to_u32());
                            }
                        }
                    }
                }
                SubstitutionSubtables::Ligature(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (first, set) in coverage.iter().zip(subtable.ligature_sets().iter()) {
                            for ligature in set.map_err(invalid)?.ligatures().iter() {
                                let ligature = ligature.map_err(invalid)?;
                                let mut input = vec![first.to_u32()];
                                input.extend(
                                    ligature
                                        .component_glyph_ids()
                                        .iter()
                                        .map(|id| id.get().to_u32()),
                                );
                                add(input, ligature.ligature_glyph().to_u32());
                            }
                        }
                    }
                }
                SubstitutionSubtables::Reverse(subtables) => {
                    for subtable in subtables.iter() {
                        let subtable = subtable.map_err(invalid)?;
                        let coverage = subtable.coverage().map_err(invalid)?;
                        for (glyph, output) in coverage.iter().zip(subtable.substitute_glyph_ids())
                        {
                            add(vec![glyph.to_u32()], output.get().to_u32());
                        }
                    }
                }
                // Contextual rules substitute only through the lookups they
                // call, which the closure above already added.
                SubstitutionSubtables::Contextual(_)
                | SubstitutionSubtables::ChainContextual(_) => {}
            }
        }
        Ok(rules
            .into_iter()
            .filter_map(|(output, input)| {
                let input = input
                    .into_iter()
                    .map(|glyph| source.host_glyph(glyph))
                    .collect::<Option<Vec<_>>>()?;
                Some(Substitution {
                    input,
                    output: source.host_glyph(output)?,
                })
            })
            .collect())
    }
}
