use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use shift_font::GlyphId;
use write_fonts::tables::gdef::GlyphClassDef;

use super::references::FeatureReferences;
use super::{FeatureDiagnostic, ShaperFont, ShaperFontError, ShaperFontRequest};

/// The shaper font for a changing font: the most recent successful
/// compilation, its glyph order with the glyphs added since, and the
/// diagnostics of the most recent request.
///
/// A request whose feature source has errors keeps the previous font active,
/// so shaping continues with the last valid features while the author repairs
/// the source. When no request has compiled yet, the font is compiled without
/// features instead, so text still shapes.
///
/// A request compiles only when something the compile reads changed: units
/// per em, the feature source, the axes and their mappings, a glyph the
/// feature source names (added, removed or renamed), or a glyph's `GDEF`
/// class. Any other added glyph is appended to the active font's glyph order,
/// past its tables, where lookups do not cover it and its class is unset, as
/// a glyph without a class compiles; a removed one keeps its place, mapped to
/// no glyph.
#[derive(Debug, Default)]
pub struct ShaperFontState {
    request: Option<ShaperFontRequest>,
    /// The last request compiled, successfully or not.
    attempt: Option<Attempt>,
    font: Option<Arc<ShaperFont>>,
    /// The Shift glyph at each shaper glyph id: the active font's glyph order,
    /// then the glyphs added since it compiled.
    glyph_order: Vec<Option<GlyphId>>,
    diagnostics: Vec<FeatureDiagnostic>,
    revision: u64,
    compiles: u64,
}

/// A compiled request, with what deciding whether a later one compiles
/// differently reads, built once per compile.
#[derive(Debug)]
struct Attempt {
    request: ShaperFontRequest,
    /// The glyphs its feature source names.
    references: FeatureReferences,
    /// Each Shift glyph's name and `GDEF` class; `.notdef` is compared on
    /// its own.
    glyphs: HashMap<GlyphId, (String, Option<GlyphClassDef>)>,
}

/// How a request differs from the last compiled one.
enum Difference {
    /// It compiles differently.
    Compiles,
    /// It compiles the same; its glyph set changed by `added` and, when
    /// `removed`, by glyphs it no longer has.
    Glyphs { added: Vec<GlyphId>, removed: bool },
}

impl ShaperFontState {
    /// Brings the state up to `request`, compiling only when something the
    /// compile reads changed (see the type's docs), and returns whether the
    /// active font changed. The glyph order follows `request` either way.
    ///
    /// # Errors
    ///
    /// Returns [`ShaperFontError`] as [`ShaperFont::compile`] does; the active
    /// font and diagnostics are then unchanged and the request is retried on
    /// the next update.
    pub fn update(&mut self, request: ShaperFontRequest) -> Result<bool, ShaperFontError> {
        if self.request.as_ref() == Some(&request) {
            return Ok(false);
        }
        let difference = match &self.attempt {
            Some(attempt) if self.font.is_some() => attempt.difference(&request),
            _ => Difference::Compiles,
        };
        if let Difference::Glyphs { added, removed } = difference {
            self.follow_glyph_order(&request, added, removed);
            self.request = Some(request);
            return Ok(false);
        }

        self.compiles += 1;
        let compilation = ShaperFont::compile(&request)?;
        let featureless = match (&compilation.font, &self.font) {
            (None, None) => ShaperFont::compile(&request.without_features())?.font,
            _ => None,
        };
        let attempt = Attempt::new(request.clone(), compilation.references);
        self.diagnostics = compilation.diagnostics;
        let Some(font) = compilation.font.or(featureless) else {
            // The last valid font stays; its glyph order still follows the
            // glyphs this request adds and removes.
            let placed: HashSet<GlyphId> = self.glyph_order.iter().flatten().copied().collect();
            let added = request
                .glyph_ids
                .iter()
                .flatten()
                .copied()
                .filter(|glyph_id| !placed.contains(glyph_id))
                .collect();
            self.attempt = Some(attempt);
            self.follow_glyph_order(&request, added, true);
            self.request = Some(request);
            return Ok(false);
        };

        self.attempt = Some(attempt);
        self.glyph_order = font.glyph_ids().to_vec();
        self.font = Some(Arc::new(font));
        self.request = Some(request);
        self.revision += 1;
        Ok(true)
    }

    /// Returns the active font: the last one compiled with its features, or
    /// the featureless fallback while none has; `None` before the first
    /// successful update.
    pub fn font(&self) -> Option<&Arc<ShaperFont>> {
        self.font.as_ref()
    }

    /// Returns the Shift glyph at each shaper glyph id, `.notdef` at 0: the
    /// active font's glyph order, then the glyphs added since it compiled;
    /// `None` for a `.notdef` the font lacks and for a removed glyph.
    pub fn glyph_order(&self) -> &[Option<GlyphId>] {
        &self.glyph_order
    }

    /// Returns the diagnostics of the most recent request, including when its
    /// source failed and an earlier font remains active.
    pub fn diagnostics(&self) -> &[FeatureDiagnostic] {
        &self.diagnostics
    }

    /// Changes whenever [`Self::font`] or [`Self::glyph_order`] does, so a
    /// copy of either is current while it is unchanged.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Counts the times a request was compiled, whether or not its feature
    /// source compiled; a request that changes nothing the compile reads is
    /// not compiled.
    pub fn compiles(&self) -> u64 {
        self.compiles
    }

    /// Appends `added`, and when `removed`, unmaps the glyphs `request` no
    /// longer has.
    fn follow_glyph_order(
        &mut self,
        request: &ShaperFontRequest,
        added: Vec<GlyphId>,
        removed: bool,
    ) {
        let mut changed = !added.is_empty();
        if removed {
            let present: HashSet<GlyphId> = request.glyph_ids.iter().flatten().copied().collect();
            for slot in &mut self.glyph_order {
                if slot.is_some_and(|glyph_id| !present.contains(&glyph_id)) {
                    *slot = None;
                    changed = true;
                }
            }
        }
        self.glyph_order.extend(added.into_iter().map(Some));
        if changed {
            self.revision += 1;
        }
    }
}

impl Attempt {
    fn new(request: ShaperFontRequest, references: FeatureReferences) -> Self {
        let glyphs = request
            .named_glyphs()
            .map(|(glyph_id, name)| {
                let class = request.gdef_classes.get(name).copied();
                (glyph_id, (name.to_string(), class))
            })
            .collect();
        Self {
            request,
            references,
            glyphs,
        }
    }

    /// How `next` differs from this attempt, in one pass over its glyphs.
    fn difference(&self, next: &ShaperFontRequest) -> Difference {
        let attempt = &self.request;
        if attempt.units_per_em != next.units_per_em
            || attempt.feature_source != next.feature_source
            || attempt.axes != next.axes
            || attempt.axis_ids != next.axis_ids
            || attempt.glyph_ids.first() != next.glyph_ids.first()
        {
            return Difference::Compiles;
        }
        let named = |name: &str| self.references.names(name);
        let mut added = Vec::new();
        let mut kept = 0;
        for (glyph_id, name) in next.named_glyphs() {
            let class = next.gdef_classes.get(name).copied();
            let Some((before_name, before_class)) = self.glyphs.get(&glyph_id) else {
                if named(name) || class.is_some() {
                    return Difference::Compiles;
                }
                added.push(glyph_id);
                continue;
            };
            kept += 1;
            let renamed = before_name != name && (named(before_name) || named(name));
            if renamed || class != *before_class {
                return Difference::Compiles;
            }
        }
        let removed = kept < self.glyphs.len();
        if removed && self.removes_a_compile_input(next) {
            return Difference::Compiles;
        }
        if self.references.by_order() && (removed || !added.is_empty()) {
            return Difference::Compiles;
        }
        Difference::Glyphs { added, removed }
    }

    /// Whether a glyph `next` no longer has is one the feature source names
    /// or one with a `GDEF` class.
    fn removes_a_compile_input(&self, next: &ShaperFontRequest) -> bool {
        let present: HashSet<GlyphId> = next.glyph_ids.iter().flatten().copied().collect();
        self.glyphs.iter().any(|(glyph_id, (name, class))| {
            !present.contains(glyph_id) && (self.references.names(name) || class.is_some())
        })
    }
}

impl ShaperFontRequest {
    /// Each Shift glyph and its name, in glyph order past `.notdef`.
    fn named_glyphs(&self) -> impl Iterator<Item = (GlyphId, &str)> {
        self.glyph_ids
            .iter()
            .zip(&self.glyph_names)
            .skip(1)
            .filter_map(|(glyph_id, name)| Some(((*glyph_id)?, name.as_str())))
    }
}
