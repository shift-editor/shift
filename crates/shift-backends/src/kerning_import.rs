//! Builds Shift kerning from source formats that name glyphs.

use std::collections::HashMap;

use shift_font::{GlyphId, Kerning, KerningPair, KerningPosition, KerningSide, SourceId};

use crate::{ImportLoss, ImportLossKind, ImportReport};

/// One side of a source-format kerning pair, still named by glyph name.
pub(crate) enum NamedKerningSide<'a> {
    Glyph(&'a str),
    Group(&'a str),
}

/// Resolves glyph names in imported kerning to the ids the import assigned.
///
/// Group members and pairs that name a glyph outside the import are dropped
/// and counted, as are members listed in more than one group for the same
/// position. [`Self::finish`] reports both counts.
pub(crate) struct KerningImport<'a> {
    kerning: Kerning,
    glyph_ids: &'a HashMap<String, GlyphId>,
    unresolved_members: usize,
    unresolved_pairs: usize,
    duplicate_members: usize,
}

impl<'a> KerningImport<'a> {
    pub(crate) fn new(glyph_ids: &'a HashMap<String, GlyphId>) -> Self {
        Self {
            kerning: Kerning::new(),
            glyph_ids,
            unresolved_members: 0,
            unresolved_pairs: 0,
            duplicate_members: 0,
        }
    }

    /// Adds a group whose name has no format prefix.
    ///
    /// A member already claimed by another group at `position` stays in that
    /// group.
    pub(crate) fn add_group<'m>(
        &mut self,
        position: KerningPosition,
        name: &str,
        members: impl IntoIterator<Item = &'m str>,
    ) {
        let mut resolved = self
            .kerning
            .group(position, name)
            .map(<[GlyphId]>::to_vec)
            .unwrap_or_default();
        for member in members {
            let Some(glyph_id) = self.glyph_ids.get(member) else {
                self.unresolved_members += 1;
                continue;
            };
            let claimed_elsewhere = self
                .kerning
                .group_of(position, glyph_id)
                .is_some_and(|group| group != name);
            if claimed_elsewhere {
                self.duplicate_members += 1;
            } else if !resolved.contains(glyph_id) {
                resolved.push(glyph_id.clone());
            }
        }
        self.kerning.set_group(position, name, resolved);
    }

    /// Sets the value of a pair at `source_id`.
    pub(crate) fn add_pair(
        &mut self,
        source_id: &SourceId,
        first: NamedKerningSide<'_>,
        second: NamedKerningSide<'_>,
        value: f64,
    ) {
        let (Some(first), Some(second)) = (self.side(first), self.side(second)) else {
            self.unresolved_pairs += 1;
            return;
        };
        self.kerning
            .set_value(source_id.clone(), KerningPair::new(first, second), value);
    }

    /// Returns the resolved kerning and records dropped references in `report`.
    pub(crate) fn finish(self, report: &mut ImportReport) -> Kerning {
        if self.unresolved_pairs > 0 {
            report.losses.push(ImportLoss {
                kind: ImportLossKind::Omitted,
                message: format!(
                    "{} kerning pairs name a glyph that is not in the font and were omitted.",
                    self.unresolved_pairs
                ),
            });
        }
        if self.unresolved_members > 0 {
            report.losses.push(ImportLoss {
                kind: ImportLossKind::Omitted,
                message: format!(
                    "{} kerning group members name a glyph that is not in the font and were omitted.",
                    self.unresolved_members
                ),
            });
        }
        if self.duplicate_members > 0 {
            report.losses.push(ImportLoss {
                kind: ImportLossKind::Omitted,
                message: format!(
                    "{} glyphs belong to more than one kerning group on the same side; each keeps only its first group.",
                    self.duplicate_members
                ),
            });
        }
        self.kerning
    }

    fn side(&self, side: NamedKerningSide<'_>) -> Option<KerningSide> {
        match side {
            NamedKerningSide::Glyph(name) => {
                self.glyph_ids.get(name).cloned().map(KerningSide::Glyph)
            }
            NamedKerningSide::Group(name) => Some(KerningSide::Group(name.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(names: &[&str]) -> HashMap<String, GlyphId> {
        names
            .iter()
            .map(|name| (name.to_string(), GlyphId::from_raw(name)))
            .collect()
    }

    #[test]
    fn references_to_missing_glyphs_are_dropped_and_reported() {
        let glyph_ids = ids(&["A", "V"]);
        let source_id = SourceId::from_raw("regular");
        let mut import = KerningImport::new(&glyph_ids);
        import.add_group(KerningPosition::First, "A", ["A", "Agrave"]);
        import.add_pair(
            &source_id,
            NamedKerningSide::Group("A"),
            NamedKerningSide::Glyph("V"),
            -40.0,
        );
        import.add_pair(
            &source_id,
            NamedKerningSide::Glyph("A"),
            NamedKerningSide::Glyph("Y"),
            -60.0,
        );

        let mut report = ImportReport::default();
        let kerning = import.finish(&mut report);

        assert_eq!(
            kerning.group(KerningPosition::First, "A"),
            Some([GlyphId::from_raw("A")].as_slice())
        );
        assert_eq!(kerning.source(&source_id).unwrap().len(), 1);
        assert_eq!(report.losses.len(), 2);
    }

    #[test]
    fn a_glyph_keeps_its_first_group_per_position() {
        let glyph_ids = ids(&["A"]);
        let mut import = KerningImport::new(&glyph_ids);
        import.add_group(KerningPosition::First, "A", ["A"]);
        import.add_group(KerningPosition::First, "B", ["A"]);
        import.add_group(KerningPosition::Second, "A", ["A"]);

        let mut report = ImportReport::default();
        let kerning = import.finish(&mut report);

        let a = GlyphId::from_raw("A");
        assert_eq!(kerning.group_of(KerningPosition::First, &a), Some("A"));
        assert_eq!(
            kerning.group(KerningPosition::First, "B"),
            Some([].as_slice())
        );
        assert_eq!(kerning.group_of(KerningPosition::Second, &a), Some("A"));
        assert_eq!(report.losses.len(), 1);
    }
}
