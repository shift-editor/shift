use crate::GlyphName;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KerningSide {
    Glyph(GlyphName),
    Group(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KerningPair {
    pub first: KerningSide,
    pub second: KerningSide,
    pub value: f64,
}

impl KerningPair {
    pub fn new(first: KerningSide, second: KerningSide, value: f64) -> Self {
        Self {
            first,
            second,
            value,
        }
    }

    pub fn glyph_pair(first: GlyphName, second: GlyphName, value: f64) -> Self {
        Self {
            first: KerningSide::Glyph(first),
            second: KerningSide::Glyph(second),
            value,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct KerningData {
    pairs: Vec<KerningPair>,
    groups1: HashMap<String, Vec<GlyphName>>,
    groups2: HashMap<String, Vec<GlyphName>>,
}

impl KerningData {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn pairs(&self) -> &[KerningPair] {
        &self.pairs
    }

    pub fn add_pair(&mut self, pair: KerningPair) {
        self.pairs.push(pair);
    }

    pub fn get_kerning(&self, first: &GlyphName, second: &GlyphName) -> Option<f64> {
        for pair in &self.pairs {
            let first_matches = match &pair.first {
                KerningSide::Glyph(g) => g == first,
                KerningSide::Group(group) => self
                    .groups1
                    .get(group)
                    .map(|members| members.contains(first))
                    .unwrap_or(false),
            };

            let second_matches = match &pair.second {
                KerningSide::Glyph(g) => g == second,
                KerningSide::Group(group) => self
                    .groups2
                    .get(group)
                    .map(|members| members.contains(second))
                    .unwrap_or(false),
            };

            if first_matches && second_matches {
                return Some(pair.value);
            }
        }
        None
    }

    pub fn groups1(&self) -> &HashMap<String, Vec<GlyphName>> {
        &self.groups1
    }

    pub fn groups2(&self) -> &HashMap<String, Vec<GlyphName>> {
        &self.groups2
    }

    pub fn set_group1(&mut self, name: String, members: Vec<GlyphName>) {
        self.groups1.insert(name, members);
    }

    pub fn set_group2(&mut self, name: String, members: Vec<GlyphName>) {
        self.groups2.insert(name, members);
    }

    pub fn is_empty(&self) -> bool {
        self.pairs.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kerning_pair_lookup() {
        let mut kerning = KerningData::new();
        kerning.add_pair(KerningPair::glyph_pair(
            "A".to_string(),
            "V".to_string(),
            -50.0,
        ));

        assert_eq!(
            kerning.get_kerning(&"A".to_string(), &"V".to_string()),
            Some(-50.0)
        );
        assert_eq!(
            kerning.get_kerning(&"A".to_string(), &"B".to_string()),
            None
        );
    }

    #[test]
    fn kerning_group_lookup() {
        let mut kerning = KerningData::new();
        kerning.set_group1(
            "public.kern1.A".to_string(),
            vec!["A".to_string(), "Aacute".to_string()],
        );
        kerning.set_group2(
            "public.kern2.V".to_string(),
            vec!["V".to_string(), "W".to_string()],
        );
        kerning.add_pair(KerningPair::new(
            KerningSide::Group("public.kern1.A".to_string()),
            KerningSide::Group("public.kern2.V".to_string()),
            -40.0,
        ));

        assert_eq!(
            kerning.get_kerning(&"A".to_string(), &"V".to_string()),
            Some(-40.0)
        );
        assert_eq!(
            kerning.get_kerning(&"Aacute".to_string(), &"W".to_string()),
            Some(-40.0)
        );
    }
}
