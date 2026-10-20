//! What a glyph is to other glyphs: an alternate, a ligature, a positional or
//! language form. Generated features are built from these.
//!
//! A glyph's relationships are the ones stored on it when it has any (an
//! empty stored list means "none"), and otherwise the ones its name implies
//! by the usual naming conventions (`a.ss01`, `f_f_i`, `beh-ar.init`,
//! `i.loclTRK`). Only explicit choices are stored, so renaming a glyph that
//! relies on its name simply follows the new name.

use std::collections::{BTreeMap, HashMap};

use crate::{Font, Glyph, GlyphId, LibValue};

/// The glyph lib key that holds a glyph's explicitly chosen relationships.
pub const RELATIONSHIPS_LIB_KEY: &str = "com.shift.relationships";

/// Where in a word a positional form is used.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Position {
    Initial,
    Medial,
    Final,
    Isolated,
}

impl Position {
    /// The feature that substitutes the form, also its glyph-name suffix.
    pub fn feature(self) -> &'static str {
        match self {
            Self::Initial => "init",
            Self::Medial => "medi",
            Self::Final => "fina",
            Self::Isolated => "isol",
        }
    }

    fn from_feature(feature: &str) -> Option<Self> {
        match feature {
            "init" => Some(Self::Initial),
            "medi" => Some(Self::Medial),
            "fina" => Some(Self::Final),
            "isol" => Some(Self::Isolated),
            _ => None,
        }
    }
}

/// One thing a glyph is to other glyphs.
#[derive(Clone, Debug, PartialEq)]
pub enum GlyphRelationship {
    /// Replaces `of` when `feature` is on: `a.ss01` is an alternate of `a` in `ss01`.
    Alternate { of: GlyphId, feature: String },
    /// Replaces the sequence `of` in `feature` (`liga`, `dlig`, `rlig`).
    Ligature { of: Vec<GlyphId>, feature: String },
    /// The form of `of` at a position in a joined word.
    PositionalForm { of: GlyphId, position: Position },
    /// The form of `of` in a language, by OpenType language tag (`TRK`).
    LanguageForm { of: GlyphId, language: String },
}

impl GlyphRelationship {
    /// The feature this relationship generates rules in.
    pub fn feature(&self) -> &str {
        match self {
            Self::Alternate { feature, .. } | Self::Ligature { feature, .. } => feature,
            Self::PositionalForm { position, .. } => position.feature(),
            Self::LanguageForm { .. } => "locl",
        }
    }

    fn to_lib(&self) -> LibValue {
        let mut entry = BTreeMap::new();
        let mut put = |key: &str, value: LibValue| {
            entry.insert(key.to_string(), value);
        };
        match self {
            Self::Alternate { of, feature } => {
                put("kind", text("alternate"));
                put("of", text(&of.to_string()));
                put("feature", text(feature));
            }
            Self::Ligature { of, feature } => {
                put("kind", text("ligature"));
                put(
                    "of",
                    LibValue::Array(of.iter().map(|id| text(&id.to_string())).collect()),
                );
                put("feature", text(feature));
            }
            Self::PositionalForm { of, position } => {
                put("kind", text("positionalForm"));
                put("of", text(&of.to_string()));
                put("position", text(position.feature()));
            }
            Self::LanguageForm { of, language } => {
                put("kind", text("languageForm"));
                put("of", text(&of.to_string()));
                put("language", text(language));
            }
        }
        LibValue::Dict(entry)
    }

    fn from_lib(value: &LibValue) -> Option<Self> {
        let LibValue::Dict(entry) = value else {
            return None;
        };
        let string = |key: &str| match entry.get(key) {
            Some(LibValue::String(value)) => Some(value.as_str()),
            _ => None,
        };
        let glyph = |key: &str| string(key)?.parse::<GlyphId>().ok();
        match string("kind")? {
            "alternate" => Some(Self::Alternate {
                of: glyph("of")?,
                feature: string("feature")?.to_string(),
            }),
            "ligature" => {
                let LibValue::Array(ids) = entry.get("of")? else {
                    return None;
                };
                let of = ids
                    .iter()
                    .map(|id| match id {
                        LibValue::String(id) => id.parse::<GlyphId>().ok(),
                        _ => None,
                    })
                    .collect::<Option<Vec<_>>>()?;
                Some(Self::Ligature {
                    of,
                    feature: string("feature")?.to_string(),
                })
            }
            "positionalForm" => Some(Self::PositionalForm {
                of: glyph("of")?,
                position: Position::from_feature(string("position")?)?,
            }),
            "languageForm" => Some(Self::LanguageForm {
                of: glyph("of")?,
                language: string("language")?.to_string(),
            }),
            _ => None,
        }
    }
}

fn text(value: &str) -> LibValue {
    LibValue::String(value.to_string())
}

impl Glyph {
    /// The relationships chosen explicitly for this glyph; `None` when it
    /// relies on its name. Entries this version cannot read are skipped.
    pub fn stored_relationships(&self) -> Option<Vec<GlyphRelationship>> {
        let LibValue::Array(entries) = self.lib().get(RELATIONSHIPS_LIB_KEY)? else {
            return None;
        };
        Some(
            entries
                .iter()
                .filter_map(GlyphRelationship::from_lib)
                .collect(),
        )
    }

    /// Chooses this glyph's relationships explicitly; `None` returns it to
    /// what its name implies.
    pub fn set_stored_relationships(&mut self, relationships: Option<&[GlyphRelationship]>) {
        match relationships {
            Some(relationships) => self.lib_mut().set(
                RELATIONSHIPS_LIB_KEY.to_string(),
                LibValue::Array(
                    relationships
                        .iter()
                        .map(GlyphRelationship::to_lib)
                        .collect(),
                ),
            ),
            None => {
                self.lib_mut().remove(RELATIONSHIPS_LIB_KEY);
            }
        }
    }
}

/// Finds glyphs by name and names glyphs by id, for working out relationships.
pub trait GlyphLookup {
    fn glyph_id_by_name(&self, name: &str) -> Option<GlyphId>;
    fn glyph_name_by_id(&self, id: &GlyphId) -> Option<&str>;
}

impl GlyphLookup for Font {
    fn glyph_id_by_name(&self, name: &str) -> Option<GlyphId> {
        Font::glyph_id_by_name(self, name)
    }

    fn glyph_name_by_id(&self, id: &GlyphId) -> Option<&str> {
        self.glyph(id).map(Glyph::name)
    }
}

/// A [`GlyphLookup`] over any list of glyphs.
pub struct GlyphIndex<'a> {
    ids: HashMap<&'a str, GlyphId>,
    names: HashMap<GlyphId, &'a str>,
}

impl<'a> GlyphIndex<'a> {
    pub fn new(glyphs: impl IntoIterator<Item = &'a Glyph>) -> Self {
        let mut ids = HashMap::new();
        let mut names = HashMap::new();
        for glyph in glyphs {
            ids.insert(glyph.name(), glyph.id());
            names.insert(glyph.id(), glyph.name());
        }
        Self { ids, names }
    }
}

impl GlyphLookup for GlyphIndex<'_> {
    fn glyph_id_by_name(&self, name: &str) -> Option<GlyphId> {
        self.ids.get(name).cloned()
    }

    fn glyph_name_by_id(&self, id: &GlyphId) -> Option<&str> {
        self.names.get(id).copied()
    }
}

/// A glyph's relationships: its stored ones, or else the ones its name implies.
pub fn relationships(glyph: &Glyph, glyphs: &impl GlyphLookup) -> Vec<GlyphRelationship> {
    glyph
        .stored_relationships()
        .unwrap_or_else(|| relationships_from_name(glyph, glyphs))
}

/// The relationships a glyph's name implies under the usual naming conventions.
pub fn relationships_from_name(glyph: &Glyph, glyphs: &impl GlyphLookup) -> Vec<GlyphRelationship> {
    let name = glyph.name();
    if let Some((stem, suffix)) = name.rsplit_once('.')
        && let Some(of) = glyphs.glyph_id_by_name(stem)
    {
        return suffix_relationships(glyphs, stem, of, suffix);
    }
    let stem_glyph = |suffix: &str| {
        name.strip_suffix(suffix)
            .and_then(|stem| glyphs.glyph_id_by_name(stem))
    };
    if let Some(of) = stem_glyph("superior") {
        return vec![alternate(of, "sups")];
    }
    if let Some(of) = stem_glyph("inferior") {
        return vec![alternate(of.clone(), "subs"), alternate(of, "sinf")];
    }
    ligature_from_name(glyphs, name).into_iter().collect()
}

impl Font {
    /// A glyph's relationships: its stored ones, or else the ones its name implies.
    pub fn relationships(&self, glyph: &Glyph) -> Vec<GlyphRelationship> {
        relationships(glyph, self)
    }

    /// The relationships a glyph's name implies under the usual naming conventions.
    pub fn relationships_from_name(&self, glyph: &Glyph) -> Vec<GlyphRelationship> {
        relationships_from_name(glyph, self)
    }
}

fn alternate(of: GlyphId, feature: &str) -> GlyphRelationship {
    GlyphRelationship::Alternate {
        of,
        feature: feature.to_string(),
    }
}

fn starts_uppercase(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

/// `name` with its first letter lowercased (`Aacute` → `aacute`), or fully
/// lowercased when it is all capitals (`AE` → `ae`).
fn lowercased(name: &str) -> Option<String> {
    let mut chars = name.chars();
    let first = chars.next()?;
    let rest: String = chars.collect();
    if rest.chars().any(char::is_lowercase) {
        return Some(first.to_lowercase().chain(rest.chars()).collect());
    }
    Some(name.to_lowercase())
}

/// What a `stem.suffix` glyph is to `stem`.
fn suffix_relationships(
    font: &impl GlyphLookup,
    stem: &str,
    of: GlyphId,
    suffix: &str,
) -> Vec<GlyphRelationship> {
    if let Some(position) = Position::from_feature(suffix) {
        return vec![GlyphRelationship::PositionalForm { of, position }];
    }
    if let Some(language) = suffix.strip_prefix("locl").filter(|tag| tag.len() == 3) {
        return vec![GlyphRelationship::LanguageForm {
            of,
            language: language.to_string(),
        }];
    }
    if is_numbered(suffix, "ss", 20) || is_numbered(suffix, "cv", 99) {
        return vec![alternate(of, suffix)];
    }
    match suffix {
        // Named after the capital (Roboto's `A.smcp`): the lowercase letter becomes
        // this small capital in smcp, and the capital in c2sc.
        "sc" | "smcp" if starts_uppercase(stem) => {
            let lower = lowercased(stem).and_then(|lower| font.glyph_id_by_name(&lower));
            let mut relationships: Vec<_> = lower
                .map(|lower| alternate(lower, "smcp"))
                .into_iter()
                .collect();
            relationships.push(alternate(of, "c2sc"));
            relationships
        }
        "sc" | "smcp" => {
            let mut relationships = vec![alternate(of, "smcp")];
            // An uppercase letter with the same name also becomes this small capital.
            if let Some(upper) = capitalized(stem).and_then(|upper| font.glyph_id_by_name(&upper)) {
                relationships.push(alternate(upper, "c2sc"));
            }
            relationships
        }
        "c2sc" => vec![alternate(of, "c2sc")],
        "case" | "salt" | "swsh" | "titl" | "zero" | "sups" | "sinf" | "numr" | "dnom" | "ordn" => {
            vec![alternate(of, suffix)]
        }
        "subs" => vec![alternate(of.clone(), "subs"), alternate(of, "sinf")],
        "tf" | "tnum" => vec![alternate(of, "tnum")],
        "osf" | "onum" => vec![alternate(of, "onum")],
        "lf" | "lnum" => vec![alternate(of, "lnum")],
        "pf" | "pnum" => vec![alternate(of, "pnum")],
        _ => Vec::new(),
    }
}

fn is_numbered(suffix: &str, prefix: &str, max: u32) -> bool {
    suffix
        .strip_prefix(prefix)
        .filter(|digits| digits.len() == 2)
        .and_then(|digits| digits.parse::<u32>().ok())
        .is_some_and(|number| (1..=max).contains(&number))
}

fn capitalized(name: &str) -> Option<String> {
    let mut chars = name.chars();
    let first = chars.next()?;
    if !first.is_lowercase() {
        return None;
    }
    Some(first.to_uppercase().chain(chars).collect())
}

/// `f_f_i` is a ligature of `f f i`; a script suffix (`lam_alef-ar`) belongs
/// to every part, and `.dlig`/`.liga` choose the feature.
fn ligature_from_name(font: &impl GlyphLookup, name: &str) -> Option<GlyphRelationship> {
    let (base, feature_suffix) = match name.rsplit_once('.') {
        Some((base, suffix @ ("liga" | "dlig" | "rlig"))) => (base, Some(suffix)),
        _ => (name, None),
    };
    if !base.contains('_') || base.contains('.') {
        return None;
    }
    let (parts, script) = match base.rsplit_once('-') {
        Some((parts, script)) if !script.contains('_') => (parts, Some(script)),
        _ => (base, None),
    };
    let names: Vec<String> = parts
        .split('_')
        .map(|part| match script {
            Some(script) => format!("{part}-{script}"),
            None => part.to_string(),
        })
        .collect();
    if names.len() < 2 {
        return None;
    }
    let of = names
        .iter()
        .map(|name| font.glyph_id_by_name(name))
        .collect::<Option<Vec<_>>>()?;
    let feature = feature_suffix.unwrap_or_else(|| default_ligature_feature(&names));
    Some(GlyphRelationship::Ligature {
        of,
        feature: feature.to_string(),
    })
}

/// The common f-ligatures are standard; lam-alef is required in Arabic; the rest are discretionary.
fn default_ligature_feature(names: &[String]) -> &'static str {
    const STANDARD: [&[&str]; 5] = [
        &["f", "f"],
        &["f", "i"],
        &["f", "l"],
        &["f", "f", "i"],
        &["f", "f", "l"],
    ];
    if STANDARD.iter().any(|standard| {
        names
            .iter()
            .map(String::as_str)
            .eq(standard.iter().copied())
    }) {
        return "liga";
    }
    let is_lam_alef = names.first().is_some_and(|name| name.starts_with("lam"))
        && names.get(1).is_some_and(|name| name.starts_with("alef"));
    if is_lam_alef { "rlig" } else { "dlig" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font_with(names: &[&str]) -> Font {
        let mut font = Font::new();
        for name in names {
            font.insert_glyph(Glyph::new(*name)).unwrap();
        }
        font
    }

    fn id(font: &Font, name: &str) -> GlyphId {
        font.glyph_id_by_name(name).unwrap()
    }

    fn implied(font: &Font, name: &str) -> Vec<GlyphRelationship> {
        font.relationships_from_name(font.glyph_by_name(name).unwrap())
    }

    #[test]
    fn suffixes_name_alternates_forms_and_figure_sets() {
        let font = font_with(&[
            "a",
            "a.ss01",
            "a.cv02",
            "A",
            "a.sc",
            "A.smcp",
            "one",
            "one.tf",
            "beh-ar",
            "beh-ar.init",
            "i",
            "i.loclTRK",
            "onesuperior",
        ]);

        assert_eq!(
            implied(&font, "a.ss01"),
            [alternate(id(&font, "a"), "ss01")]
        );
        assert_eq!(
            implied(&font, "a.cv02"),
            [alternate(id(&font, "a"), "cv02")]
        );
        assert_eq!(
            implied(&font, "a.sc"),
            [
                alternate(id(&font, "a"), "smcp"),
                alternate(id(&font, "A"), "c2sc")
            ]
        );
        assert_eq!(
            implied(&font, "A.smcp"),
            [
                alternate(id(&font, "a"), "smcp"),
                alternate(id(&font, "A"), "c2sc")
            ],
            "a small capital named after its capital serves both features"
        );
        assert_eq!(
            implied(&font, "one.tf"),
            [alternate(id(&font, "one"), "tnum")]
        );
        assert_eq!(
            implied(&font, "beh-ar.init"),
            [GlyphRelationship::PositionalForm {
                of: id(&font, "beh-ar"),
                position: Position::Initial
            }]
        );
        assert_eq!(
            implied(&font, "i.loclTRK"),
            [GlyphRelationship::LanguageForm {
                of: id(&font, "i"),
                language: "TRK".into()
            }]
        );
        assert_eq!(
            implied(&font, "onesuperior"),
            [alternate(id(&font, "one"), "sups")]
        );
    }

    #[test]
    fn underscores_name_ligatures_of_existing_parts() {
        let font = font_with(&[
            "f",
            "i",
            "f_i",
            "f_f_i",
            "c",
            "t",
            "c_t",
            "lam-ar",
            "alef-ar",
            "lam_alef-ar",
            "x_y",
        ]);
        let ligature = |names: &[&str], feature: &str| GlyphRelationship::Ligature {
            of: names.iter().map(|name| id(&font, name)).collect(),
            feature: feature.into(),
        };

        assert_eq!(implied(&font, "f_i"), [ligature(&["f", "i"], "liga")]);
        assert_eq!(
            implied(&font, "f_f_i"),
            [ligature(&["f", "f", "i"], "liga")]
        );
        assert_eq!(implied(&font, "c_t"), [ligature(&["c", "t"], "dlig")]);
        assert_eq!(
            implied(&font, "lam_alef-ar"),
            [ligature(&["lam-ar", "alef-ar"], "rlig")]
        );
        // Parts that do not exist imply nothing.
        assert!(implied(&font, "x_y").is_empty());
    }

    #[test]
    fn stored_relationships_override_the_name_and_survive_the_lib_round_trip() {
        let mut font = font_with(&["a", "b", "a.ss01"]);
        let chosen = [alternate(id(&font, "b"), "ss03")];
        let glyph_id = id(&font, "a.ss01");
        font.set_glyph_relationships(&glyph_id, Some(&chosen))
            .unwrap();

        let glyph = font.glyph(&glyph_id).unwrap();
        assert_eq!(glyph.stored_relationships().as_deref(), Some(&chosen[..]));
        assert_eq!(font.relationships(glyph), chosen);

        let mut glyph = glyph.clone();
        glyph.set_stored_relationships(Some(&[]));
        assert!(font.relationships(&glyph).is_empty());
        glyph.set_stored_relationships(None);
        assert_eq!(
            font.relationships(&glyph),
            [alternate(id(&font, "a"), "ss01")]
        );
    }
}
