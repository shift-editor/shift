use shift_glyph_codec::OutlineCommand;

use crate::{curve::curves_from_commands, Bounds, Curve, Point, Section, SlugError};

const CURVE_BYTES: usize = 24;
const VARIABLE_GLYPH_BYTES: usize = 32;

/// One glyph in a two-source resident variable atlas.
///
/// `bounds` encloses both source curve control hulls, so every interpolation in
/// `0..=1` can use the same grid while GPU compute rebuilds exact band membership.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VariableGlyph {
    pub bounds: Bounds,
    pub curve_start: u32,
    pub curve_count: u32,
}

/// Byte ranges for one packed two-source variable atlas.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableLayout {
    pub base_curves: Section,
    pub curve_deltas: Section,
    pub glyphs: Section,
    pub total_length: usize,
}

/// CPU-owned two-source Slug model.
///
/// Curves are converted independently at both authored sources. Compatible
/// command topology is required, and each source curve is stored as a delta
/// from the base. No location-resolved bands or curve indexes are resident;
/// those are generated only for visible glyphs by GPU compute.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VariableAtlas {
    band_count: u32,
    base_curves: Vec<Curve>,
    curve_deltas: Vec<Curve>,
    glyphs: Vec<VariableGlyph>,
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

    pub fn statistics(&self) -> VariableStatistics {
        VariableStatistics {
            glyph_count: self.glyphs.len(),
            curve_count: self.base_curves.len(),
            bands_per_direction: self.band_count,
            max_curves_per_glyph: self
                .glyphs
                .iter()
                .map(|glyph| glyph.curve_count)
                .max()
                .unwrap_or(0),
        }
    }

    /// Resolves one glyph with the same f32 arithmetic used by the compute shader.
    pub fn resolve_glyph(
        &self,
        glyph_index: u32,
        source_weight: f32,
    ) -> Result<Vec<Curve>, SlugError> {
        if !source_weight.is_finite() {
            return Err(SlugError::NonFiniteVariableWeight);
        }
        let glyph = self
            .glyphs
            .get(glyph_index as usize)
            .ok_or(SlugError::GlyphIndexOutOfRange(glyph_index))?;
        let start = glyph.curve_start as usize;
        let end = start
            .checked_add(glyph.curve_count as usize)
            .ok_or(SlugError::LengthOverflow)?;

        Ok(self.base_curves[start..end]
            .iter()
            .zip(&self.curve_deltas[start..end])
            .map(|(base, delta)| add_scaled_curve(*base, *delta, source_weight))
            .collect())
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
        let total_length = glyphs
            .offset
            .checked_add(glyphs.length)
            .ok_or(SlugError::LengthOverflow)?;

        Ok(VariableLayout {
            base_curves,
            curve_deltas,
            glyphs,
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
            for value in [glyph.curve_start, glyph.curve_count, 0, 0] {
                write(&mut bytes, &mut offset, &value.to_le_bytes());
            }
        }

        Ok(PackedVariableAtlas { bytes, layout })
    }
}

/// Sizing summary for a two-source variable atlas.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableStatistics {
    pub glyph_count: usize,
    pub curve_count: usize,
    pub bands_per_direction: u32,
    pub max_curves_per_glyph: u32,
}

/// Incrementally builds a topology-compatible two-source variable atlas.
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

        let base_curves = curves_from_commands(base_commands)?;
        let source_curves = curves_from_commands(source_commands)?;
        self.add_curve_glyph(base_curves, source_curves)
    }

    /// Adds curves whose correspondence was established from stable source topology.
    ///
    /// Production adapters should prefer this boundary after deriving both
    /// sources from the same authored point/segment recipe. Comparing two
    /// location-resolved pen streams is only a fixture convenience because a
    /// binary outline drawer may change emitted command kinds at degeneracies.
    pub fn add_curve_glyph(
        &mut self,
        base_curves: impl IntoIterator<Item = Curve>,
        source_curves: impl IntoIterator<Item = Curve>,
    ) -> Result<u32, SlugError> {
        let base_curves: Vec<_> = base_curves.into_iter().collect();
        let source_curves: Vec<_> = source_curves.into_iter().collect();
        let glyph_index = as_u32(self.atlas.glyphs.len())?;
        if base_curves.len() != source_curves.len() {
            return Err(SlugError::VariableTopologyMismatch { glyph_index });
        }

        let curve_start = as_u32(self.atlas.base_curves.len())?;
        let curve_count = as_u32(base_curves.len())?;
        let bounds = variable_bounds(&base_curves, &source_curves);
        let curve_deltas = base_curves
            .iter()
            .zip(&source_curves)
            .map(|(base, source)| subtract_curve(*source, *base))
            .collect::<Vec<_>>();

        ensure_total(self.atlas.base_curves.len(), base_curves.len())?;
        ensure_total(self.atlas.curve_deltas.len(), curve_deltas.len())?;
        ensure_total(self.atlas.glyphs.len(), 1)?;

        self.atlas.base_curves.extend(base_curves);
        self.atlas.curve_deltas.extend(curve_deltas);
        self.atlas.glyphs.push(VariableGlyph {
            bounds,
            curve_start,
            curve_count,
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

/// Owned aligned bytes for the resident two-source model.
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

fn variable_bounds(base: &[Curve], source: &[Curve]) -> Bounds {
    let mut curves = base.iter().chain(source).copied();
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
