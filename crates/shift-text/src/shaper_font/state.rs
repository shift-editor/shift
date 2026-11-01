use std::collections::HashSet;
use std::sync::Arc;

use shift_font::{GlyphId, OpenTypeCategory};
use write_fonts::tables::gdef::GlyphClassDef;

use super::inputs::{CompileInput, CompiledGlyphs, FeatureSource, GlyphChange, ShaperAxes};
use super::references::FeatureReferences;
use super::{
    FeatureDiagnostic, ShaperFont, ShaperFontError, ShaperFontRequest, ShaperGlyphOrder, UnitsPerEm,
};

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
    compiled: Option<Compiled>,
    diagnostics: Vec<FeatureDiagnostic>,
    #[cfg(any(test, feature = "test-support"))]
    compiles: u64,
}

/// The active font, what the last compile read, and the glyph order shaping
/// uses.
#[derive(Debug)]
struct Compiled {
    font: Arc<ShaperFont>,
    /// What the last compile read: the active font's inputs, or a later
    /// request's whose feature source did not compile.
    inputs: CompiledInputs,
    /// The active font's glyph order, then the glyphs added since.
    glyph_order: ShaperGlyphOrder,
    /// Changes whenever `font` or `glyph_order` does.
    revision: u64,
}

/// What a compile read, part by part.
#[derive(Debug)]
struct CompiledInputs {
    units_per_em: UnitsPerEm,
    feature_source: FeatureSource,
    axes: ShaperAxes,
    glyphs: CompiledGlyphs,
}

impl CompiledInputs {
    fn new(request: ShaperFontRequest, references: FeatureReferences) -> Self {
        Self {
            glyphs: CompiledGlyphs::new(&request.glyphs, references),
            units_per_em: request.units_per_em,
            feature_source: request.feature_source,
            axes: request.axes,
        }
    }

    /// How `next` differs: `None` when it compiles differently, else how its
    /// glyph set moved.
    fn difference(&self, next: &ShaperFontRequest) -> Option<GlyphChange> {
        let recompiles = self.units_per_em.recompiles(&next.units_per_em)
            || self.feature_source.recompiles(&next.feature_source)
            || self.axes.recompiles(&next.axes);
        if recompiles {
            return None;
        }
        self.glyphs.change(&next.glyphs)
    }
}

impl Compiled {
    fn new(font: ShaperFont, inputs: CompiledInputs, revision: u64) -> Self {
        Self {
            glyph_order: font.glyph_order().clone(),
            font: Arc::new(font),
            inputs,
            revision,
        }
    }

    /// Unmaps the glyphs `request` no longer has, when `removed`, and
    /// appends `added`; bumps the revision when the order moved.
    fn follow(
        &mut self,
        request: &ShaperFontRequest,
        added: Vec<GlyphId>,
        removed: bool,
    ) -> Result<(), ShaperFontError> {
        let mut moved = !added.is_empty();
        if removed {
            let present: HashSet<GlyphId> = request.glyphs.ids.iter().flatten().copied().collect();
            moved |= self.glyph_order.unmap_absent(&present);
        }
        self.glyph_order.extend(added.into_iter().map(Some))?;
        if moved {
            self.revision += 1;
        }
        Ok(())
    }

    /// Follows every glyph `request` has that the order lacks, and every one
    /// it removed: after a compile that kept this font.
    fn follow_all(&mut self, request: &ShaperFontRequest) -> Result<(), ShaperFontError> {
        let added = request
            .glyphs
            .ids
            .iter()
            .flatten()
            .copied()
            .filter(|glyph_id| !self.glyph_order.contains(*glyph_id))
            .collect();
        self.follow(request, added, true)
    }
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
        if let Some(compiled) = self.compiled.as_mut()
            && let Some(GlyphChange { added, removed }) = compiled.inputs.difference(&request)
        {
            compiled.follow(&request, added, removed)?;
            return Ok(false);
        }

        #[cfg(any(test, feature = "test-support"))]
        {
            self.compiles += 1;
        }
        let compilation = ShaperFont::compile(&request)?;
        self.diagnostics = compilation.diagnostics;
        if let Some(font) = compilation.font {
            let revision = self.revision() + 1;
            let inputs = CompiledInputs::new(request, compilation.references);
            self.compiled = Some(Compiled::new(font, inputs, revision));
            return Ok(true);
        }
        if let Some(compiled) = self.compiled.as_mut() {
            // The last valid font stays; its glyph order still follows the
            // glyphs this request adds and removes.
            compiled.follow_all(&request)?;
            compiled.inputs = CompiledInputs::new(request, compilation.references);
            return Ok(false);
        }
        let Some(font) = ShaperFont::compile(&request.without_features())?.font else {
            return Ok(false);
        };
        let inputs = CompiledInputs::new(request, compilation.references);
        self.compiled = Some(Compiled::new(font, inputs, 1));
        Ok(true)
    }

    /// Returns the active font: the last one compiled with its features, or
    /// the featureless fallback while none has; `None` before the first
    /// successful update.
    pub fn font(&self) -> Option<&Arc<ShaperFont>> {
        self.compiled.as_ref().map(|compiled| &compiled.font)
    }

    /// Returns the Shift glyph at each shaper glyph id, `.notdef` at 0: the
    /// active font's glyph order, then the glyphs added since it compiled;
    /// `None` for a `.notdef` the font lacks and for a removed glyph. Empty
    /// before the first successful update.
    pub fn glyph_order(&self) -> &ShaperGlyphOrder {
        static EMPTY: std::sync::OnceLock<ShaperGlyphOrder> = std::sync::OnceLock::new();
        self.compiled.as_ref().map_or_else(
            || EMPTY.get_or_init(ShaperGlyphOrder::default),
            |compiled| &compiled.glyph_order,
        )
    }

    /// Returns `glyph`'s `GDEF` class in the active font; `None` for a glyph
    /// it does not class, such as one added since it compiled, which the
    /// compile would have classed only by compiling again.
    pub fn class(&self, glyph: GlyphId) -> Option<OpenTypeCategory> {
        let class = self.compiled.as_ref()?.inputs.glyphs.class(glyph)?;
        match class {
            GlyphClassDef::Base => Some(OpenTypeCategory::Base),
            GlyphClassDef::Ligature => Some(OpenTypeCategory::Ligature),
            GlyphClassDef::Mark => Some(OpenTypeCategory::Mark),
            GlyphClassDef::Component => Some(OpenTypeCategory::Component),
            _ => None,
        }
    }

    /// Returns the diagnostics of the most recent request, including when its
    /// source failed and an earlier font remains active.
    pub fn diagnostics(&self) -> &[FeatureDiagnostic] {
        &self.diagnostics
    }

    /// Changes whenever [`Self::font`] or [`Self::glyph_order`] does, so a
    /// copy of either is current while it is unchanged.
    pub fn revision(&self) -> u64 {
        self.compiled
            .as_ref()
            .map_or(0, |compiled| compiled.revision)
    }

    /// Counts the times a request was compiled, whether or not its feature
    /// source compiled; a request that changes nothing the compile reads is
    /// not compiled. For tests.
    #[cfg(any(test, feature = "test-support"))]
    pub fn compiles(&self) -> u64 {
        self.compiles
    }
}
