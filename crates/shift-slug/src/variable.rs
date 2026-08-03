use crate::{
    curve::{
        cubic_subdivision_counts_from_commands,
        curves_and_line_flags_from_commands_with_subdivisions,
    },
    Bounds, Curve, OutlineCommand, Point, Section, SlugError, LINE_EPSILON,
};

const CURVE_BYTES: usize = 24;
const DEFAULT_PACK_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const VARIABLE_GLYPH_BYTES: usize = 32;
const VARIABLE_SOURCE_BYTES: usize = 8;
const BASE_SOURCE_DELTA: u32 = u32::MAX;
const SPARSE_SOURCE_FLAG: u32 = 1 << 31;
const SOURCE_OFFSET_MASK: u32 = !SPARSE_SOURCE_FLAG;
const COMPONENT_GLYPH_FLAG: u32 = 1 << 31;
const GLYPH_OFFSET_MASK: u32 = !COMPONENT_GLYPH_FLAG;
pub const VARIABLE_PARAMS_BYTES: usize = 64;

mod component;
pub(crate) use component::ROOT_COMPONENT;
pub use component::{
    VariableAnchorSource, VariableComponent, VariableComponentGlyph, VariableComponentPart,
    VariableComponentSource,
};

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

/// Font-space overflow shared by every preview cell at one authored revision.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SlugPreviewExtents {
    pub horizontal: f32,
    pub minimum_y: f32,
    pub maximum_y: f32,
}

/// One source contribution for a variable glyph.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableSource {
    /// Dense delta start, tagged sparse-table offset, or `u32::MAX` for the base.
    pub delta_start: u32,
    /// Index in the small per-frame deduplicated weight buffer.
    pub weight_index: u32,
}

/// Byte ranges for one packed resident variable atlas.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableLayout {
    pub base_curves: Section,
    pub curve_deltas: Section,
    pub sparse_deltas: Section,
    pub glyphs: Section,
    pub sources: Section,
    pub source_advances: Section,
    pub component_glyphs: Section,
    pub component_parts: Section,
    pub components: Section,
    pub component_sources: Section,
    pub anchor_sources: Section,
    pub line_bits: Section,
    pub total_length: usize,
}

/// Inputs and resident section offsets consumed by the variable shader.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableParams {
    pub instance_count: u32,
    pub band_count: u32,
    pub atlas_split_offset: u32,
    pub layout: VariableLayout,
}

/// Packs the variable shader uniform as sixteen little-endian `u32` words.
pub fn pack_variable_params(
    params: VariableParams,
) -> Result<[u8; VARIABLE_PARAMS_BYTES], SlugError> {
    let words = [
        params.instance_count,
        params.band_count,
        params.atlas_split_offset,
        0,
        as_u32(params.layout.base_curves.offset)?,
        as_u32(params.layout.curve_deltas.offset)?,
        as_u32(params.layout.sparse_deltas.offset)?,
        as_u32(params.layout.glyphs.offset)?,
        as_u32(params.layout.sources.offset)?,
        as_u32(params.layout.source_advances.offset)?,
        as_u32(params.layout.component_glyphs.offset)?,
        as_u32(params.layout.component_parts.offset)?,
        as_u32(params.layout.components.offset)?,
        as_u32(params.layout.component_sources.offset)?,
        as_u32(params.layout.anchor_sources.offset)?,
        as_u32(params.layout.line_bits.offset)?,
    ];
    let mut bytes = [0; VARIABLE_PARAMS_BYTES];
    for (index, word) in words.into_iter().enumerate() {
        let start = index * std::mem::size_of::<u32>();
        bytes[start..start + std::mem::size_of::<u32>()].copy_from_slice(&word.to_le_bytes());
    }
    Ok(bytes)
}

/// CPU-owned resident Slug variation model.
///
/// Compatible curve topology is required. Each non-base source uses dense
/// base-relative curve deltas or a sorted sparse subset, whichever occupies fewer
/// bytes. No location-resolved bounds, bands, or curve indexes are resident;
/// those are generated only for visible glyphs by GPU compute.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VariableAtlas {
    band_count: u32,
    base_curves: Vec<Curve>,
    curve_deltas: Vec<Curve>,
    sparse_deltas: Vec<u32>,
    glyphs: Vec<VariableGlyph>,
    sources: Vec<VariableSource>,
    source_advances: Vec<f32>,
    component_glyphs: Vec<VariableComponentGlyph>,
    component_parts: Vec<VariableComponentPart>,
    components: Vec<VariableComponent>,
    component_sources: Vec<VariableComponentSource>,
    anchor_sources: Vec<VariableAnchorSource>,
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

    /// Sparse descriptors followed by their sorted glyph-local curve indexes.
    pub fn sparse_deltas(&self) -> &[u32] {
        &self.sparse_deltas
    }

    pub fn glyphs(&self) -> &[VariableGlyph] {
        &self.glyphs
    }

    pub fn sources(&self) -> &[VariableSource] {
        &self.sources
    }

    pub fn source_advances(&self) -> &[f32] {
        &self.source_advances
    }

    pub fn component_glyphs(&self) -> &[VariableComponentGlyph] {
        &self.component_glyphs
    }

    pub fn component_parts(&self) -> &[VariableComponentPart] {
        &self.component_parts
    }

    pub fn components(&self) -> &[VariableComponent] {
        &self.components
    }

    pub fn component_sources(&self) -> &[VariableComponentSource] {
        &self.component_sources
    }

    pub fn anchor_sources(&self) -> &[VariableAnchorSource] {
        &self.anchor_sources
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
            delta_index_count: self
                .sources
                .iter()
                .filter_map(|source| sparse_descriptor_start(*source))
                .filter_map(|start| self.sparse_deltas.get(start + 1))
                .map(|count| *count as usize)
                .sum(),
            source_count: self.sources.len(),
            dense_delta_source_count: self
                .sources
                .iter()
                .filter(|source| {
                    source.delta_start != BASE_SOURCE_DELTA
                        && source.delta_start & SPARSE_SOURCE_FLAG == 0
                })
                .count(),
            sparse_delta_source_count: self
                .sources
                .iter()
                .filter(|source| sparse_descriptor_start(**source).is_some())
                .count(),
            line_curve_count: self
                .line_bits
                .iter()
                .map(|word| word.count_ones() as usize)
                .sum(),
            component_glyph_count: self.component_glyphs.len(),
            component_part_count: self.component_parts.len(),
            component_count: self.components.len(),
            component_source_count: self.component_sources.len(),
            anchor_source_count: self.anchor_sources.len(),
            bands_per_direction: self.band_count,
            max_curves_per_glyph: self
                .glyphs
                .iter()
                .map(|glyph| glyph.curve_count)
                .max()
                .unwrap_or(0),
        }
    }

    /// Derives shared preview overflow without changing the existing pixels-per-em scale.
    pub fn preview_extents(&self, glyph_indices: &[u32]) -> Result<SlugPreviewExtents, SlugError> {
        let mut horizontal = 0.0_f32;
        let mut minimum_y = f32::INFINITY;
        let mut maximum_y = f32::NEG_INFINITY;

        for glyph_index in glyph_indices {
            let glyph = *self
                .glyphs
                .get(*glyph_index as usize)
                .ok_or(SlugError::GlyphIndexOutOfRange(*glyph_index))?;
            let advance_glyph = match component_glyph_index(glyph) {
                Some(component_index) => {
                    let component = self
                        .component_glyphs
                        .get(component_index)
                        .ok_or(SlugError::LengthOverflow)?;
                    *self
                        .glyphs
                        .get(component.root_glyph_index as usize)
                        .ok_or(SlugError::LengthOverflow)?
                }
                None => glyph,
            };
            let advance_start = advance_glyph.source_start as usize;
            let advance_end = advance_start
                .checked_add(advance_glyph.source_count as usize)
                .ok_or(SlugError::LengthOverflow)?;
            let minimum_advance = self
                .source_advances
                .get(advance_start..advance_end)
                .ok_or(SlugError::LengthOverflow)?
                .iter()
                .copied()
                .fold(f32::INFINITY, f32::min);
            let minimum_advance = if minimum_advance.is_finite() {
                minimum_advance
            } else {
                0.0
            };

            horizontal = horizontal
                .max((-glyph.bounds.min_x).max(0.0))
                .max((glyph.bounds.max_x - minimum_advance).max(0.0));
            minimum_y = minimum_y.min(glyph.bounds.min_y);
            maximum_y = maximum_y.max(glyph.bounds.max_y);
        }

        if minimum_y.is_infinite() {
            minimum_y = 0.0;
            maximum_y = 0.0;
        }

        Ok(SlugPreviewExtents {
            horizontal,
            minimum_y,
            maximum_y,
        })
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
        if component_glyph_index(*glyph).is_some() {
            return component::resolve_component_glyph(self, *glyph, weights);
        }
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
            let Some(descriptor_start) = sparse_descriptor_start(*source) else {
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
                continue;
            };

            let delta_start = *self
                .sparse_deltas
                .get(descriptor_start)
                .ok_or(SlugError::LengthOverflow)? as usize;
            let delta_count = *self
                .sparse_deltas
                .get(descriptor_start + 1)
                .ok_or(SlugError::LengthOverflow)? as usize;
            let delta_end = delta_start
                .checked_add(delta_count)
                .ok_or(SlugError::LengthOverflow)?;
            let index_start = descriptor_start + 2;
            let index_end = index_start
                .checked_add(delta_count)
                .ok_or(SlugError::LengthOverflow)?;
            let deltas = self
                .curve_deltas
                .get(delta_start..delta_end)
                .ok_or(SlugError::LengthOverflow)?;
            let indices = self
                .sparse_deltas
                .get(index_start..index_end)
                .ok_or(SlugError::LengthOverflow)?;
            for (local_index, delta) in indices.iter().zip(deltas) {
                let curve = curves
                    .get_mut(*local_index as usize)
                    .ok_or(SlugError::LengthOverflow)?;
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

    /// Resolves horizontal advance from the same resident source weights.
    pub fn resolve_advance_with_weights(
        &self,
        glyph_index: u32,
        weights: &[f32],
    ) -> Result<f32, SlugError> {
        if weights.iter().any(|weight| !weight.is_finite()) {
            return Err(SlugError::NonFiniteVariableWeight);
        }
        let glyph = self
            .glyphs
            .get(glyph_index as usize)
            .ok_or(SlugError::GlyphIndexOutOfRange(glyph_index))?;
        if let Some(component_glyph_index) = component_glyph_index(*glyph) {
            let component_glyph = self
                .component_glyphs
                .get(component_glyph_index)
                .ok_or(SlugError::LengthOverflow)?;
            return self.resolve_advance_with_weights(component_glyph.root_glyph_index, weights);
        }
        let source_start = glyph.source_start as usize;
        let source_end = source_start
            .checked_add(glyph.source_count as usize)
            .ok_or(SlugError::LengthOverflow)?;
        let sources = self
            .sources
            .get(source_start..source_end)
            .ok_or(SlugError::LengthOverflow)?;
        let advances = self
            .source_advances
            .get(source_start..source_end)
            .ok_or(SlugError::LengthOverflow)?;
        sources
            .iter()
            .zip(advances)
            .try_fold(0.0_f32, |advance, (source, source_advance)| {
                let weight = weights.get(source.weight_index as usize).ok_or(
                    SlugError::VariableWeightIndexOutOfRange(source.weight_index),
                )?;
                Ok(advance + source_advance * weight)
            })
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
        let sparse_deltas = next_section(
            curve_deltas,
            self.sparse_deltas.len(),
            std::mem::size_of::<u32>(),
            alignment,
        )?;
        let glyphs = next_section(
            sparse_deltas,
            self.glyphs.len(),
            VARIABLE_GLYPH_BYTES,
            alignment,
        )?;
        let sources = next_section(glyphs, self.sources.len(), VARIABLE_SOURCE_BYTES, alignment)?;
        let source_advances = next_section(
            sources,
            self.source_advances.len(),
            std::mem::size_of::<f32>(),
            alignment,
        )?;
        let component_glyphs = next_section(
            source_advances,
            self.component_glyphs.len(),
            component::VARIABLE_COMPONENT_GLYPH_BYTES,
            alignment,
        )?;
        let component_parts = next_section(
            component_glyphs,
            self.component_parts.len(),
            component::VARIABLE_COMPONENT_PART_BYTES,
            alignment,
        )?;
        let components = next_section(
            component_parts,
            self.components.len(),
            component::VARIABLE_COMPONENT_BYTES,
            alignment,
        )?;
        let component_sources = next_section(
            components,
            self.component_sources.len(),
            component::VARIABLE_COMPONENT_SOURCE_BYTES,
            alignment,
        )?;
        let anchor_sources = next_section(
            component_sources,
            self.anchor_sources.len(),
            component::VARIABLE_ANCHOR_SOURCE_BYTES,
            alignment,
        )?;
        let line_bits = next_section(
            anchor_sources,
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
            sparse_deltas,
            glyphs,
            sources,
            source_advances,
            component_glyphs,
            component_parts,
            components,
            component_sources,
            anchor_sources,
            line_bits,
            total_length,
        })
    }

    pub fn pack(&self, alignment: usize) -> Result<PackedVariableAtlas, SlugError> {
        let expected = self.layout(alignment)?;
        let mut bytes = Vec::with_capacity(expected.total_length);
        let maximum_length = expected.total_length.clamp(4, DEFAULT_PACK_CHUNK_BYTES);
        let layout = self.write_packed_chunks(alignment, maximum_length, |chunk| {
            bytes.extend_from_slice(chunk.bytes);
        })?;
        debug_assert_eq!(bytes.len(), layout.total_length);
        Ok(PackedVariableAtlas { bytes, layout })
    }

    /// Serializes deterministic resident bytes through a bounded reusable chunk.
    ///
    /// Consumers can write each callback slice directly into its final GPU-buffer
    /// offset. No full packed copy coexists with the authored atlas, and dropping
    /// the atlas after the callback releases all redundant CPU geometry.
    pub fn write_packed_chunks(
        &self,
        alignment: usize,
        maximum_length: usize,
        emit: impl FnMut(PackedVariableChunk<'_>),
    ) -> Result<VariableLayout, SlugError> {
        if maximum_length == 0 || !maximum_length.is_multiple_of(4) {
            return Err(SlugError::InvalidChunkSize(maximum_length));
        }
        let layout = self.layout(alignment)?;
        let mut writer = PackedChunkWriter::new(maximum_length, emit);

        writer.pad_to(layout.base_curves.offset)?;
        writer.write_curves(&self.base_curves);
        writer.pad_to(layout.curve_deltas.offset)?;
        writer.write_curves(&self.curve_deltas);
        writer.pad_to(layout.sparse_deltas.offset)?;
        for word in &self.sparse_deltas {
            writer.write(&word.to_le_bytes());
        }
        writer.pad_to(layout.glyphs.offset)?;
        for glyph in &self.glyphs {
            for value in [
                glyph.bounds.min_x,
                glyph.bounds.min_y,
                glyph.bounds.max_x,
                glyph.bounds.max_y,
            ] {
                writer.write(&value.to_le_bytes());
            }
            for value in [
                glyph.curve_start,
                glyph.curve_count,
                glyph.source_start,
                glyph.source_count,
            ] {
                writer.write(&value.to_le_bytes());
            }
        }
        writer.pad_to(layout.sources.offset)?;
        for source in &self.sources {
            writer.write(&source.delta_start.to_le_bytes());
            writer.write(&source.weight_index.to_le_bytes());
        }
        writer.pad_to(layout.source_advances.offset)?;
        for advance in &self.source_advances {
            writer.write(&advance.to_le_bytes());
        }
        writer.pad_to(layout.component_glyphs.offset)?;
        component::write_component_glyphs(&mut writer, &self.component_glyphs);
        writer.pad_to(layout.component_parts.offset)?;
        component::write_component_parts(&mut writer, &self.component_parts);
        writer.pad_to(layout.components.offset)?;
        component::write_components(&mut writer, &self.components);
        writer.pad_to(layout.component_sources.offset)?;
        component::write_component_sources(&mut writer, &self.component_sources);
        writer.pad_to(layout.anchor_sources.offset)?;
        component::write_anchor_sources(&mut writer, &self.anchor_sources);
        writer.pad_to(layout.line_bits.offset)?;
        for word in &self.line_bits {
            writer.write(&word.to_le_bytes());
        }
        writer.pad_to(layout.total_length)?;
        writer.finish();

        Ok(layout)
    }
}

/// Sizing summary for a resident variable atlas.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableStatistics {
    pub glyph_count: usize,
    pub curve_count: usize,
    pub delta_curve_count: usize,
    pub delta_index_count: usize,
    pub source_count: usize,
    pub dense_delta_source_count: usize,
    pub sparse_delta_source_count: usize,
    pub line_curve_count: usize,
    pub component_glyph_count: usize,
    pub component_part_count: usize,
    pub component_count: usize,
    pub component_source_count: usize,
    pub anchor_source_count: usize,
    pub bands_per_direction: u32,
    pub max_curves_per_glyph: u32,
}

/// Incrementally builds a topology-compatible resident variable atlas.
#[derive(Debug)]
pub struct VariableAtlasBuilder {
    atlas: VariableAtlas,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct VariableAtlasCheckpoint {
    base_curves: usize,
    curve_deltas: usize,
    sparse_deltas: usize,
    glyphs: usize,
    sources: usize,
    source_advances: usize,
    component_glyphs: usize,
    component_parts: usize,
    components: usize,
    component_sources: usize,
    anchor_sources: usize,
    line_bits: usize,
    last_line_word: Option<u32>,
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

        let base_subdivision_counts =
            cubic_subdivision_counts_from_commands(base_commands.iter().copied())?;
        let source_subdivision_counts =
            cubic_subdivision_counts_from_commands(source_commands.iter().copied())?;
        if base_subdivision_counts.len() != source_subdivision_counts.len() {
            return Err(SlugError::VariableTopologyMismatch { glyph_index });
        }
        let shared_subdivision_counts = base_subdivision_counts
            .into_iter()
            .zip(source_subdivision_counts)
            .map(|(base, source)| base.max(source))
            .collect::<Vec<_>>();
        let (base_curves, line_flags) = curves_and_line_flags_from_commands_with_subdivisions(
            base_commands,
            &shared_subdivision_counts,
        )?;
        let (source_curves, source_line_flags) =
            curves_and_line_flags_from_commands_with_subdivisions(
                source_commands,
                &shared_subdivision_counts,
            )?;
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
    /// degeneracies. Production adapters must use the authored topology boundary,
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
        let source_start = direct_source_offset(self.atlas.sources.len())?;
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
        let mut sparse_deltas = Vec::new();
        let mut sources = Vec::with_capacity(source_curves.len() + 1);
        sources.push(VariableSource {
            delta_start: BASE_SOURCE_DELTA,
            weight_index: base_weight_index,
        });
        for (weight_index, curves) in &source_curves {
            let deltas = base_curves
                .iter()
                .zip(curves)
                .map(|(base, source)| subtract_curve(*source, *base))
                .collect::<Vec<_>>();
            let changed = deltas
                .iter()
                .copied()
                .enumerate()
                .filter(|(_, delta)| !curve_is_zero(*delta))
                .collect::<Vec<_>>();
            let dense_bytes = byte_length(deltas.len(), CURVE_BYTES)?;
            let sparse_values_bytes =
                byte_length(changed.len(), CURVE_BYTES + std::mem::size_of::<u32>())?;
            let sparse_bytes = sparse_values_bytes
                .checked_add(2 * std::mem::size_of::<u32>())
                .ok_or(SlugError::LengthOverflow)?;
            let delta_start = as_u32(
                self.atlas
                    .curve_deltas
                    .len()
                    .checked_add(curve_deltas.len())
                    .ok_or(SlugError::LengthOverflow)?,
            )?;
            if sparse_bytes < dense_bytes {
                let descriptor_start = self
                    .atlas
                    .sparse_deltas
                    .len()
                    .checked_add(sparse_deltas.len())
                    .ok_or(SlugError::LengthOverflow)?;
                sparse_deltas.push(delta_start);
                sparse_deltas.push(as_u32(changed.len())?);
                for (local_index, delta) in changed {
                    sparse_deltas.push(as_u32(local_index)?);
                    curve_deltas.push(delta);
                }
                sources.push(VariableSource {
                    delta_start: tagged_sparse_offset(descriptor_start)?,
                    weight_index: *weight_index,
                });
            } else {
                sources.push(VariableSource {
                    delta_start: dense_delta_offset(delta_start)?,
                    weight_index: *weight_index,
                });
                curve_deltas.extend(deltas);
            }
        }

        ensure_total(self.atlas.base_curves.len(), base_curves.len())?;
        ensure_total(self.atlas.curve_deltas.len(), curve_deltas.len())?;
        ensure_total(self.atlas.sparse_deltas.len(), sparse_deltas.len())?;
        ensure_total(self.atlas.sources.len(), sources.len())?;
        ensure_total(self.atlas.source_advances.len(), sources.len())?;
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
        self.atlas.sparse_deltas.extend(sparse_deltas);
        self.atlas
            .source_advances
            .extend(std::iter::repeat_n(0.0, sources.len()));
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

    /// Assigns one finite horizontal advance per resident source contribution.
    pub fn set_glyph_source_advances(
        &mut self,
        glyph_index: u32,
        advances: impl IntoIterator<Item = f32>,
    ) -> Result<(), SlugError> {
        let advances = advances.into_iter().collect::<Vec<_>>();
        let glyph = self
            .atlas
            .glyphs
            .get(glyph_index as usize)
            .ok_or(SlugError::GlyphIndexOutOfRange(glyph_index))?;
        let expected = glyph.source_count as usize;
        if advances.len() != expected {
            return Err(SlugError::VariableAdvanceCountMismatch {
                glyph_index,
                expected,
                actual: advances.len(),
            });
        }
        if let Some(source_index) = advances.iter().position(|advance| !advance.is_finite()) {
            return Err(SlugError::NonFiniteVariableAdvance {
                glyph_index,
                source_index,
            });
        }
        let start = glyph.source_start as usize;
        let end = start
            .checked_add(expected)
            .ok_or(SlugError::LengthOverflow)?;
        self.atlas
            .source_advances
            .get_mut(start..end)
            .ok_or(SlugError::LengthOverflow)?
            .copy_from_slice(&advances);
        Ok(())
    }

    pub(crate) fn checkpoint(&self) -> VariableAtlasCheckpoint {
        VariableAtlasCheckpoint {
            base_curves: self.atlas.base_curves.len(),
            curve_deltas: self.atlas.curve_deltas.len(),
            sparse_deltas: self.atlas.sparse_deltas.len(),
            glyphs: self.atlas.glyphs.len(),
            sources: self.atlas.sources.len(),
            source_advances: self.atlas.source_advances.len(),
            component_glyphs: self.atlas.component_glyphs.len(),
            component_parts: self.atlas.component_parts.len(),
            components: self.atlas.components.len(),
            component_sources: self.atlas.component_sources.len(),
            anchor_sources: self.atlas.anchor_sources.len(),
            line_bits: self.atlas.line_bits.len(),
            last_line_word: self.atlas.line_bits.last().copied(),
        }
    }

    pub(crate) fn rollback(&mut self, checkpoint: VariableAtlasCheckpoint) {
        self.atlas.base_curves.truncate(checkpoint.base_curves);
        self.atlas.curve_deltas.truncate(checkpoint.curve_deltas);
        self.atlas.sparse_deltas.truncate(checkpoint.sparse_deltas);
        self.atlas.glyphs.truncate(checkpoint.glyphs);
        self.atlas.sources.truncate(checkpoint.sources);
        self.atlas
            .source_advances
            .truncate(checkpoint.source_advances);
        self.atlas
            .component_glyphs
            .truncate(checkpoint.component_glyphs);
        self.atlas
            .component_parts
            .truncate(checkpoint.component_parts);
        self.atlas.components.truncate(checkpoint.components);
        self.atlas
            .component_sources
            .truncate(checkpoint.component_sources);
        self.atlas
            .anchor_sources
            .truncate(checkpoint.anchor_sources);
        self.atlas.line_bits.truncate(checkpoint.line_bits);
        if let (Some(last), Some(value)) =
            (self.atlas.line_bits.last_mut(), checkpoint.last_line_word)
        {
            *last = value;
        }
    }

    pub(crate) fn glyph(&self, glyph_index: u32) -> Result<VariableGlyph, SlugError> {
        self.atlas
            .glyphs
            .get(glyph_index as usize)
            .copied()
            .ok_or(SlugError::GlyphIndexOutOfRange(glyph_index))
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

    /// Borrows queue-write-sized pieces without duplicating the packed atlas.
    pub fn chunks(&self, maximum_length: usize) -> Result<PackedVariableChunks<'_>, SlugError> {
        if maximum_length == 0 || !maximum_length.is_multiple_of(4) {
            return Err(SlugError::InvalidChunkSize(maximum_length));
        }
        Ok(PackedVariableChunks {
            bytes: &self.bytes,
            maximum_length,
            offset: 0,
        })
    }
}

/// One borrowed piece of a packed variable-atlas upload.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PackedVariableChunk<'a> {
    pub offset: usize,
    pub bytes: &'a [u8],
}

/// Borrowed chunks spanning a packed atlas exactly once.
#[derive(Clone, Debug)]
pub struct PackedVariableChunks<'a> {
    bytes: &'a [u8],
    maximum_length: usize,
    offset: usize,
}

impl<'a> Iterator for PackedVariableChunks<'a> {
    type Item = PackedVariableChunk<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.offset == self.bytes.len() {
            return None;
        }
        let end = self
            .offset
            .saturating_add(self.maximum_length)
            .min(self.bytes.len());
        let chunk = PackedVariableChunk {
            offset: self.offset,
            bytes: &self.bytes[self.offset..end],
        };
        self.offset = end;
        Some(chunk)
    }
}

struct PackedChunkWriter<F> {
    emit: F,
    bytes: Vec<u8>,
    maximum_length: usize,
    offset: usize,
}

impl<F> PackedChunkWriter<F>
where
    F: FnMut(PackedVariableChunk<'_>),
{
    fn new(maximum_length: usize, emit: F) -> Self {
        Self {
            emit,
            bytes: Vec::with_capacity(maximum_length),
            maximum_length,
            offset: 0,
        }
    }

    fn position(&self) -> usize {
        self.offset + self.bytes.len()
    }

    fn write(&mut self, mut value: &[u8]) {
        while !value.is_empty() {
            let available = self.maximum_length - self.bytes.len();
            let count = available.min(value.len());
            self.bytes.extend_from_slice(&value[..count]);
            value = &value[count..];
            if self.bytes.len() == self.maximum_length {
                self.flush();
            }
        }
    }

    fn write_curves(&mut self, curves: &[Curve]) {
        for curve in curves {
            for value in [
                curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y,
            ] {
                self.write(&value.to_le_bytes());
            }
        }
    }

    fn pad_to(&mut self, target: usize) -> Result<(), SlugError> {
        let padding = target
            .checked_sub(self.position())
            .ok_or(SlugError::LengthOverflow)?;
        const ZEROS: [u8; 256] = [0; 256];
        let mut remaining = padding;
        while remaining != 0 {
            let count = remaining.min(ZEROS.len());
            self.write(&ZEROS[..count]);
            remaining -= count;
        }
        Ok(())
    }

    fn flush(&mut self) {
        if self.bytes.is_empty() {
            return;
        }
        (self.emit)(PackedVariableChunk {
            offset: self.offset,
            bytes: &self.bytes,
        });
        self.offset += self.bytes.len();
        self.bytes.clear();
    }

    fn finish(mut self) {
        self.flush();
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

fn curve_is_zero(curve: Curve) -> bool {
    [
        curve.p0.x, curve.p0.y, curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y,
    ]
    .into_iter()
    .all(|value| value == 0.0)
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

fn direct_source_offset(offset: usize) -> Result<u32, SlugError> {
    let offset = as_u32(offset)?;
    if offset <= GLYPH_OFFSET_MASK {
        Ok(offset)
    } else {
        Err(SlugError::LengthOverflow)
    }
}

fn dense_delta_offset(offset: u32) -> Result<u32, SlugError> {
    if offset <= SOURCE_OFFSET_MASK {
        Ok(offset)
    } else {
        Err(SlugError::LengthOverflow)
    }
}

fn tagged_sparse_offset(offset: usize) -> Result<u32, SlugError> {
    let offset = as_u32(offset)?;
    if offset <= SOURCE_OFFSET_MASK {
        Ok(SPARSE_SOURCE_FLAG | offset)
    } else {
        Err(SlugError::LengthOverflow)
    }
}

fn sparse_descriptor_start(source: VariableSource) -> Option<usize> {
    (source.delta_start != BASE_SOURCE_DELTA && source.delta_start & SPARSE_SOURCE_FLAG != 0)
        .then_some((source.delta_start & SOURCE_OFFSET_MASK) as usize)
}

fn component_glyph_index(glyph: VariableGlyph) -> Option<usize> {
    (glyph.source_start & COMPONENT_GLYPH_FLAG != 0)
        .then_some((glyph.source_start & GLYPH_OFFSET_MASK) as usize)
}
