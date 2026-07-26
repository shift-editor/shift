use shift_glyph_codec::OutlineCommand;

use crate::{
    curve::curves_and_line_flags_from_commands, Bounds, Curve, Point, Section, SlugError,
    LINE_EPSILON,
};

const CURVE_BYTES: usize = 24;
const VARIABLE_GLYPH_BYTES: usize = 32;
const VARIABLE_SOURCE_BYTES: usize = 8;
const BASE_SOURCE_DELTA: u32 = u32::MAX;

/// One glyph in a resident variable atlas.
///
/// `bounds` is a source-envelope fallback for empty geometry and diagnostics.
/// Non-empty visible glyphs reduce exact current-location bounds into scratch
/// before band construction and fragment selection.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VariableGlyph {
    pub bounds: Bounds,
    pub curve_start: u32,
    pub curve_count: u32,
    pub source_start: u32,
    pub source_count: u32,
}

/// One source contribution for a variable glyph.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableSource {
    /// First delta curve, or `u32::MAX` for the base source.
    pub delta_start: u32,
    /// Index in the small per-frame deduplicated weight buffer.
    pub weight_index: u32,
}

/// Byte ranges for one packed resident variable atlas.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableLayout {
    pub base_curves: Section,
    pub curve_deltas: Section,
    pub glyphs: Section,
    pub sources: Section,
    pub line_bits: Section,
    pub total_length: usize,
}

/// CPU-owned resident Slug variation model.
///
/// Compatible curve topology is required, and each non-base source curve is
/// stored as a delta from the base. No location-resolved bounds, bands, or curve
/// indexes are resident; those are generated only for visible glyphs by GPU compute.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VariableAtlas {
    band_count: u32,
    base_curves: Vec<Curve>,
    curve_deltas: Vec<Curve>,
    glyphs: Vec<VariableGlyph>,
    sources: Vec<VariableSource>,
    line_bits: Vec<u32>,
}

impl VariableAtlas {
    pub fn band_count(&self) -> u32 {
        self.band_count
    }

    pub fn base_curves(&self) -> &[Curve] {
        &self.base_curves
    }

    pub fn curve_deltas(&self) -> &[Curve] {
        &self.curve_deltas
    }

    pub fn glyphs(&self) -> &[VariableGlyph] {
        &self.glyphs
    }

    pub fn sources(&self) -> &[VariableSource] {
        &self.sources
    }

    pub fn line_bits(&self) -> &[u32] {
        &self.line_bits
    }

    pub fn curve_is_line(&self, curve_index: usize) -> bool {
        self.line_bits
            .get(curve_index / 32)
            .is_some_and(|word| word & (1 << (curve_index % 32)) != 0)
    }

    pub fn statistics(&self) -> VariableStatistics {
        VariableStatistics {
            glyph_count: self.glyphs.len(),
            curve_count: self.base_curves.len(),
            delta_curve_count: self.curve_deltas.len(),
            source_count: self.sources.len(),
            line_curve_count: self
                .line_bits
                .iter()
                .map(|word| word.count_ones() as usize)
                .sum(),
            bands_per_direction: self.band_count,
            max_curves_per_glyph: self
                .glyphs
                .iter()
                .map(|glyph| glyph.curve_count)
                .max()
                .unwrap_or(0),
        }
    }

    /// Resolves the common two-source model with the compute shader's f32 arithmetic.
    pub fn resolve_glyph(
        &self,
        glyph_index: u32,
        source_weight: f32,
    ) -> Result<Vec<Curve>, SlugError> {
        if !source_weight.is_finite() {
            return Err(SlugError::NonFiniteVariableWeight);
        }
        self.resolve_glyph_with_weights(glyph_index, &[1.0 - source_weight, source_weight])
    }

    /// Resolves one glyph from an arbitrary deduplicated source-weight buffer.
    pub fn resolve_glyph_with_weights(
        &self,
        glyph_index: u32,
        weights: &[f32],
    ) -> Result<Vec<Curve>, SlugError> {
        if weights.iter().any(|weight| !weight.is_finite()) {
            return Err(SlugError::NonFiniteVariableWeight);
        }
        let glyph = self
            .glyphs
            .get(glyph_index as usize)
            .ok_or(SlugError::GlyphIndexOutOfRange(glyph_index))?;
        let curve_start = glyph.curve_start as usize;
        let curve_end = curve_start
            .checked_add(glyph.curve_count as usize)
            .ok_or(SlugError::LengthOverflow)?;
        let source_start = glyph.source_start as usize;
        let source_end = source_start
            .checked_add(glyph.source_count as usize)
            .ok_or(SlugError::LengthOverflow)?;
        let sources = self
            .sources
            .get(source_start..source_end)
            .ok_or(SlugError::LengthOverflow)?;
        let mut weight_sum = 0.0_f32;
        for source in sources {
            weight_sum += *weights.get(source.weight_index as usize).ok_or(
                SlugError::VariableWeightIndexOutOfRange(source.weight_index),
            )?;
        }

        let mut curves = self.base_curves[curve_start..curve_end]
            .iter()
            .map(|curve| scale_curve(*curve, weight_sum))
            .collect::<Vec<_>>();
        for source in sources {
            if source.delta_start == BASE_SOURCE_DELTA {
                continue;
            }
            let weight = weights[source.weight_index as usize];
            let delta_start = source.delta_start as usize;
            let delta_end = delta_start
                .checked_add(glyph.curve_count as usize)
                .ok_or(SlugError::LengthOverflow)?;
            for (curve, delta) in curves.iter_mut().zip(
                self.curve_deltas
                    .get(delta_start..delta_end)
                    .ok_or(SlugError::LengthOverflow)?,
            ) {
                *curve = add_scaled_curve(*curve, *delta, weight);
            }
        }
        for (local_index, curve) in curves.iter_mut().enumerate() {
            if self.curve_is_line(curve_start + local_index) {
                *curve = Curve::from_line(curve.p0, curve.p2);
            }
        }
        Ok(curves)
    }

    pub fn layout(&self, alignment: usize) -> Result<VariableLayout, SlugError> {
        if alignment == 0 || !alignment.is_power_of_two() {
            return Err(SlugError::InvalidAlignment(alignment));
        }

        let base_curves = Section {
            offset: 0,
            length: byte_length(self.base_curves.len(), CURVE_BYTES)?,
        };
        let curve_deltas =
            next_section(base_curves, self.curve_deltas.len(), CURVE_BYTES, alignment)?;
        let glyphs = next_section(
            curve_deltas,
            self.glyphs.len(),
            VARIABLE_GLYPH_BYTES,
            alignment,
        )?;
        let sources = next_section(glyphs, self.sources.len(), VARIABLE_SOURCE_BYTES, alignment)?;
        let line_bits = next_section(
            sources,
            self.line_bits.len(),
            std::mem::size_of::<u32>(),
            alignment,
        )?;
        let total_length = line_bits
            .offset
            .checked_add(line_bits.length)
            .ok_or(SlugError::LengthOverflow)?;

        Ok(VariableLayout {
            base_curves,
            curve_deltas,
            glyphs,
            sources,
            line_bits,
            total_length,
        })
    }

    pub fn pack(&self, alignment: usize) -> Result<PackedVariableAtlas, SlugError> {
        let layout = self.layout(alignment)?;
        let mut bytes = vec![0; layout.total_length];

        write_curves(&mut bytes, layout.base_curves.offset, &self.base_curves);
        write_curves(&mut bytes, layout.curve_deltas.offset, &self.curve_deltas);

        let mut offset = layout.glyphs.offset;
        for glyph in &self.glyphs {
            for value in [
                glyph.bounds.min_x,
                glyph.bounds.min_y,
                glyph.bounds.max_x,
                glyph.bounds.max_y,
            ] {
                write(&mut bytes, &mut offset, &value.to_le_bytes());
            }
            for value in [
                glyph.curve_start,
                glyph.curve_count,
                glyph.source_start,
                glyph.source_count,
            ] {
                write(&mut bytes, &mut offset, &value.to_le_bytes());
            }
        }

        offset = layout.sources.offset;
        for source in &self.sources {
            write(&mut bytes, &mut offset, &source.delta_start.to_le_bytes());
            write(&mut bytes, &mut offset, &source.weight_index.to_le_bytes());
        }

        offset = layout.line_bits.offset;
        for word in &self.line_bits {
            write(&mut bytes, &mut offset, &word.to_le_bytes());
        }

        Ok(PackedVariableAtlas { bytes, layout })
    }
}

/// Sizing summary for a resident variable atlas.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableStatistics {
    pub glyph_count: usize,
    pub curve_count: usize,
    pub delta_curve_count: usize,
    pub source_count: usize,
    pub line_curve_count: usize,
    pub bands_per_direction: u32,
    pub max_curves_per_glyph: u32,
}

/// Incrementally builds a topology-compatible resident variable atlas.
#[derive(Debug)]
pub struct VariableAtlasBuilder {
    atlas: VariableAtlas,
}

impl VariableAtlasBuilder {
    pub fn new(band_count: u32) -> Result<Self, SlugError> {
        if !(1..=crate::MAX_BAND_COUNT).contains(&band_count) {
            return Err(SlugError::InvalidBandCount(band_count));
        }

        Ok(Self {
            atlas: VariableAtlas {
                band_count,
                ..Default::default()
            },
        })
    }

    pub fn add_glyph(
        &mut self,
        base_commands: impl IntoIterator<Item = OutlineCommand<f32>>,
        source_commands: impl IntoIterator<Item = OutlineCommand<f32>>,
    ) -> Result<u32, SlugError> {
        let base_commands: Vec<_> = base_commands.into_iter().collect();
        let source_commands: Vec<_> = source_commands.into_iter().collect();
        let glyph_index = as_u32(self.atlas.glyphs.len())?;

        if command_topology(&base_commands) != command_topology(&source_commands) {
            return Err(SlugError::VariableTopologyMismatch { glyph_index });
        }

        let (base_curves, line_flags) = curves_and_line_flags_from_commands(base_commands)?;
        let (source_curves, source_line_flags) =
            curves_and_line_flags_from_commands(source_commands)?;
        if line_flags != source_line_flags {
            return Err(SlugError::VariableTopologyMismatch { glyph_index });
        }
        self.add_curve_glyph_with_sources_and_lines(
            base_curves,
            line_flags,
            0,
            [(1, source_curves)],
        )
    }

    /// Adds curves whose correspondence was established from stable source topology.
    ///
    /// Comparing two location-resolved pen streams is only a fixture convenience
    /// because a binary outline drawer may change emitted command kinds at
    /// degeneracies. Production adapters must use the authored recipe boundary,
    /// including line flags for controls regenerated after interpolation.
    pub fn add_curve_glyph(
        &mut self,
        base_curves: impl IntoIterator<Item = Curve>,
        source_curves: impl IntoIterator<Item = Curve>,
    ) -> Result<u32, SlugError> {
        self.add_curve_glyph_with_sources(
            base_curves,
            0,
            [(1, source_curves.into_iter().collect())],
        )
    }

    /// Adds compatible curves that contain no synthetic Slug line controls.
    pub fn add_curve_glyph_with_sources(
        &mut self,
        base_curves: impl IntoIterator<Item = Curve>,
        base_weight_index: u32,
        source_curves: impl IntoIterator<Item = (u32, Vec<Curve>)>,
    ) -> Result<u32, SlugError> {
        let base_curves = base_curves.into_iter().collect::<Vec<_>>();
        let line_flags = vec![false; base_curves.len()];
        self.add_curve_glyph_with_sources_and_lines(
            base_curves,
            line_flags,
            base_weight_index,
            source_curves,
        )
    }

    /// Adds stable source curves and marks controls regenerated from line endpoints.
    pub fn add_curve_glyph_with_sources_and_lines(
        &mut self,
        base_curves: impl IntoIterator<Item = Curve>,
        line_flags: impl IntoIterator<Item = bool>,
        base_weight_index: u32,
        source_curves: impl IntoIterator<Item = (u32, Vec<Curve>)>,
    ) -> Result<u32, SlugError> {
        let base_curves: Vec<_> = base_curves.into_iter().collect();
        let line_flags: Vec<_> = line_flags.into_iter().collect();
        let source_curves: Vec<_> = source_curves.into_iter().collect();
        let glyph_index = as_u32(self.atlas.glyphs.len())?;
        if source_curves
            .iter()
            .any(|(_, curves)| curves.len() != base_curves.len())
        {
            return Err(SlugError::VariableTopologyMismatch { glyph_index });
        }
        if line_flags.len() != base_curves.len() {
            return Err(SlugError::VariableLineFlagMismatch { glyph_index });
        }

        let curve_start = as_u32(self.atlas.base_curves.len())?;
        let curve_count = as_u32(base_curves.len())?;
        let source_start = as_u32(self.atlas.sources.len())?;
        let source_count = as_u32(
            source_curves
                .len()
                .checked_add(1)
                .ok_or(SlugError::LengthOverflow)?,
        )?;
        let mut bounds = variable_bounds(
            base_curves
                .iter()
                .chain(source_curves.iter().flat_map(|(_, curves)| curves)),
        );
        if line_flags.iter().any(|is_line| *is_line) && !base_curves.is_empty() {
            bounds.min_x -= LINE_EPSILON;
            bounds.min_y -= LINE_EPSILON;
            bounds.max_x += LINE_EPSILON;
            bounds.max_y += LINE_EPSILON;
        }
        let mut curve_deltas = Vec::new();
        let mut sources = Vec::with_capacity(source_curves.len() + 1);
        sources.push(VariableSource {
            delta_start: BASE_SOURCE_DELTA,
            weight_index: base_weight_index,
        });
        for (weight_index, curves) in &source_curves {
            let delta_start = as_u32(
                self.atlas
                    .curve_deltas
                    .len()
                    .checked_add(curve_deltas.len())
                    .ok_or(SlugError::LengthOverflow)?,
            )?;
            sources.push(VariableSource {
                delta_start,
                weight_index: *weight_index,
            });
            curve_deltas.extend(
                base_curves
                    .iter()
                    .zip(curves)
                    .map(|(base, source)| subtract_curve(*source, *base)),
            );
        }

        ensure_total(self.atlas.base_curves.len(), base_curves.len())?;
        ensure_total(self.atlas.curve_deltas.len(), curve_deltas.len())?;
        ensure_total(self.atlas.sources.len(), sources.len())?;
        ensure_total(self.atlas.glyphs.len(), 1)?;
        let total_curves = self
            .atlas
            .base_curves
            .len()
            .checked_add(base_curves.len())
            .ok_or(SlugError::LengthOverflow)?;
        let required_line_words = total_curves.div_ceil(32);
        as_u32(required_line_words)?;

        append_line_flags(
            &mut self.atlas.line_bits,
            self.atlas.base_curves.len(),
            &line_flags,
        );
        self.atlas.base_curves.extend(base_curves);
        self.atlas.curve_deltas.extend(curve_deltas);
        self.atlas.sources.extend(sources);
        self.atlas.glyphs.push(VariableGlyph {
            bounds,
            curve_start,
            curve_count,
            source_start,
            source_count,
        });

        Ok(glyph_index)
    }

    pub fn finish(self) -> VariableAtlas {
        self.atlas
    }
}

impl Default for VariableAtlasBuilder {
    fn default() -> Self {
        Self::new(crate::DEFAULT_BAND_COUNT).expect("default Slug band count is valid")
    }
}

/// Owned aligned bytes for the resident variable model.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackedVariableAtlas {
    bytes: Vec<u8>,
    layout: VariableLayout,
}

impl PackedVariableAtlas {
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn layout(&self) -> VariableLayout {
        self.layout
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CommandKind {
    Move,
    Line,
    Quad,
    Cubic,
    Close,
}

fn command_topology(commands: &[OutlineCommand<f32>]) -> Vec<CommandKind> {
    commands
        .iter()
        .map(|command| match command {
            OutlineCommand::Move { .. } => CommandKind::Move,
            OutlineCommand::Line { .. } => CommandKind::Line,
            OutlineCommand::Quad { .. } => CommandKind::Quad,
            OutlineCommand::Cubic { .. } => CommandKind::Cubic,
            OutlineCommand::Close => CommandKind::Close,
        })
        .collect()
}

fn append_line_flags(words: &mut Vec<u32>, curve_start: usize, line_flags: &[bool]) {
    words.resize((curve_start + line_flags.len()).div_ceil(32), 0);
    for (local_index, is_line) in line_flags.iter().enumerate() {
        if *is_line {
            let curve_index = curve_start + local_index;
            words[curve_index / 32] |= 1 << (curve_index % 32);
        }
    }
}

fn variable_bounds<'a>(curves: impl IntoIterator<Item = &'a Curve>) -> Bounds {
    let mut curves = curves.into_iter().copied();
    let Some(first) = curves.next() else {
        return Bounds::default();
    };
    let mut bounds = first.bounds();
    for curve in curves {
        let curve_bounds = curve.bounds();
        bounds.min_x = bounds.min_x.min(curve_bounds.min_x);
        bounds.min_y = bounds.min_y.min(curve_bounds.min_y);
        bounds.max_x = bounds.max_x.max(curve_bounds.max_x);
        bounds.max_y = bounds.max_y.max(curve_bounds.max_y);
    }
    bounds
}

fn subtract_curve(source: Curve, base: Curve) -> Curve {
    Curve {
        p0: subtract_point(source.p0, base.p0),
        p1: subtract_point(source.p1, base.p1),
        p2: subtract_point(source.p2, base.p2),
    }
}

fn subtract_point(source: Point, base: Point) -> Point {
    Point::new(source.x - base.x, source.y - base.y)
}

fn scale_curve(curve: Curve, scale: f32) -> Curve {
    Curve {
        p0: Point::new(curve.p0.x * scale, curve.p0.y * scale),
        p1: Point::new(curve.p1.x * scale, curve.p1.y * scale),
        p2: Point::new(curve.p2.x * scale, curve.p2.y * scale),
    }
}

fn add_scaled_curve(base: Curve, delta: Curve, weight: f32) -> Curve {
    Curve {
        p0: add_scaled_point(base.p0, delta.p0, weight),
        p1: add_scaled_point(base.p1, delta.p1, weight),
        p2: add_scaled_point(base.p2, delta.p2, weight),
    }
}

fn add_scaled_point(base: Point, delta: Point, weight: f32) -> Point {
    Point::new(base.x + delta.x * weight, base.y + delta.y * weight)
}

fn write_curves(target: &mut [u8], start: usize, curves: &[Curve]) {
    let mut offset = start;
    for curve in curves {
        for value in [
            curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y,
        ] {
            write(target, &mut offset, &value.to_le_bytes());
        }
    }
}

fn next_section(
    previous: Section,
    count: usize,
    stride: usize,
    alignment: usize,
) -> Result<Section, SlugError> {
    let previous_end = previous
        .offset
        .checked_add(previous.length)
        .ok_or(SlugError::LengthOverflow)?;
    let offset = previous_end
        .checked_add(alignment - 1)
        .map(|value| value & !(alignment - 1))
        .ok_or(SlugError::LengthOverflow)?;

    Ok(Section {
        offset,
        length: byte_length(count, stride)?,
    })
}

fn byte_length(count: usize, stride: usize) -> Result<usize, SlugError> {
    count.checked_mul(stride).ok_or(SlugError::LengthOverflow)
}

fn ensure_total(current: usize, additional: usize) -> Result<(), SlugError> {
    let total = current
        .checked_add(additional)
        .ok_or(SlugError::LengthOverflow)?;
    as_u32(total).map(|_| ())
}

fn as_u32(value: usize) -> Result<u32, SlugError> {
    u32::try_from(value).map_err(|_| SlugError::LengthOverflow)
}

fn write(target: &mut [u8], offset: &mut usize, value: &[u8]) {
    let end = *offset + value.len();
    target[*offset..end].copy_from_slice(value);
    *offset = end;
}
