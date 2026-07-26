use crate::{Bounds, Curve, Point, SlugError};

use super::{
    as_u32, component_glyph_index, ensure_total, PackedChunkWriter, PackedVariableChunk,
    VariableAtlas, VariableAtlasBuilder, VariableGlyph, COMPONENT_GLYPH_FLAG, GLYPH_OFFSET_MASK,
};

pub(super) const VARIABLE_COMPONENT_GLYPH_BYTES: usize = 24;
pub(super) const VARIABLE_COMPONENT_PART_BYTES: usize = 16;
pub(super) const VARIABLE_COMPONENT_BYTES: usize = 32;
pub(super) const VARIABLE_COMPONENT_SOURCE_BYTES: usize = 40;
pub(super) const VARIABLE_ANCHOR_SOURCE_BYTES: usize = 12;

pub const ROOT_COMPONENT: u32 = u32::MAX;

/// Sparse descriptor for one glyph whose direct and component contours are assembled on GPU.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableComponentGlyph {
    pub part_start: u32,
    pub part_count: u32,
    pub component_start: u32,
    pub component_count: u32,
    pub root_glyph_index: u32,
    pub _padding: u32,
}

/// One contiguous direct-contour contribution to a component glyph.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableComponentPart {
    pub glyph_index: u32,
    /// Local component occurrence, or [`ROOT_COMPONENT`] for direct root contours.
    pub component_index: u32,
    pub output_curve_start: u32,
    pub _padding: u32,
}

/// One ordered component occurrence using Rust-selected attachment relationships.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct VariableComponent {
    /// Local parent occurrence, or [`ROOT_COMPONENT`] for a root child.
    pub parent_component: u32,
    pub source_start: u32,
    pub source_count: u32,
    pub source_anchor_start: u32,
    pub source_anchor_count: u32,
    pub target_anchor_start: u32,
    pub target_anchor_count: u32,
    /// Local attachment target occurrence, or [`ROOT_COMPONENT`] when unattached.
    pub target_component: u32,
}

/// One weighted authored decomposed-transform sample.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VariableComponentSource {
    pub weight_index: u32,
    pub translate_x: f32,
    pub translate_y: f32,
    pub rotation: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub skew_x: f32,
    pub skew_y: f32,
    pub center_x: f32,
    pub center_y: f32,
}

/// One weighted authored anchor-position sample.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VariableAnchorSource {
    pub weight_index: u32,
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct Affine {
    xx: f32,
    xy: f32,
    yx: f32,
    yy: f32,
    dx: f32,
    dy: f32,
}

impl Affine {
    fn identity() -> Self {
        Self {
            xx: 1.0,
            yy: 1.0,
            ..Self::default()
        }
    }

    fn compose(self, inner: Self) -> Self {
        Self {
            xx: self.xx * inner.xx + self.yx * inner.xy,
            xy: self.xy * inner.xx + self.yy * inner.xy,
            yx: self.xx * inner.yx + self.yx * inner.yy,
            yy: self.xy * inner.yx + self.yy * inner.yy,
            dx: self.xx * inner.dx + self.yx * inner.dy + self.dx,
            dy: self.xy * inner.dx + self.yy * inner.dy + self.dy,
        }
    }

    fn point(self, point: Point) -> Point {
        Point::new(
            self.xx * point.x + self.yx * point.y + self.dx,
            self.xy * point.x + self.yy * point.y + self.dy,
        )
    }

    fn curve(self, curve: Curve) -> Curve {
        Curve {
            p0: self.point(curve.p0),
            p1: self.point(curve.p1),
            p2: self.point(curve.p2),
        }
    }
}

impl VariableAtlasBuilder {
    pub(crate) fn add_component_glyph(
        &mut self,
        bounds: Bounds,
        root_glyph_index: u32,
        parts: Vec<VariableComponentPart>,
        mut components: Vec<VariableComponent>,
        component_sources: Vec<VariableComponentSource>,
        anchor_sources: Vec<VariableAnchorSource>,
    ) -> Result<u32, SlugError> {
        let root_glyph = self.glyph(root_glyph_index)?;
        if component_glyph_index(root_glyph).is_some() {
            return Err(SlugError::LengthOverflow);
        }

        let glyph_index = as_u32(self.atlas.glyphs.len())?;
        let descriptor_index = as_u32(self.atlas.component_glyphs.len())?;
        if descriptor_index > GLYPH_OFFSET_MASK {
            return Err(SlugError::LengthOverflow);
        }
        let part_start = as_u32(self.atlas.component_parts.len())?;
        let component_start = as_u32(self.atlas.components.len())?;
        let component_source_start = as_u32(self.atlas.component_sources.len())?;
        let anchor_source_start = as_u32(self.atlas.anchor_sources.len())?;

        let mut curve_count = 0_u32;
        for part in &parts {
            let direct_glyph = self.glyph(part.glyph_index)?;
            if component_glyph_index(direct_glyph).is_some()
                || part.output_curve_start != curve_count
                || (part.component_index != ROOT_COMPONENT
                    && part.component_index as usize >= components.len())
            {
                return Err(SlugError::LengthOverflow);
            }
            curve_count = curve_count
                .checked_add(direct_glyph.curve_count)
                .ok_or(SlugError::LengthOverflow)?;
        }

        let component_count = components.len();
        for component in &mut components {
            if component.parent_component != ROOT_COMPONENT
                && component.parent_component as usize >= component_count
            {
                return Err(SlugError::LengthOverflow);
            }
            if component.target_component != ROOT_COMPONENT
                && component.target_component as usize >= component_count
            {
                return Err(SlugError::LengthOverflow);
            }
            component.source_start = component
                .source_start
                .checked_add(component_source_start)
                .ok_or(SlugError::LengthOverflow)?;
            component.source_anchor_start = component
                .source_anchor_start
                .checked_add(anchor_source_start)
                .ok_or(SlugError::LengthOverflow)?;
            component.target_anchor_start = component
                .target_anchor_start
                .checked_add(anchor_source_start)
                .ok_or(SlugError::LengthOverflow)?;
        }

        ensure_total(self.atlas.glyphs.len(), 1)?;
        ensure_total(self.atlas.component_glyphs.len(), 1)?;
        ensure_total(self.atlas.component_parts.len(), parts.len())?;
        ensure_total(self.atlas.components.len(), components.len())?;
        ensure_total(self.atlas.component_sources.len(), component_sources.len())?;
        ensure_total(self.atlas.anchor_sources.len(), anchor_sources.len())?;

        self.atlas.component_glyphs.push(VariableComponentGlyph {
            part_start,
            part_count: as_u32(parts.len())?,
            component_start,
            component_count: as_u32(components.len())?,
            root_glyph_index,
            _padding: 0,
        });
        self.atlas.component_parts.extend(parts);
        self.atlas.components.extend(components);
        self.atlas.component_sources.extend(component_sources);
        self.atlas.anchor_sources.extend(anchor_sources);
        self.atlas.glyphs.push(VariableGlyph {
            bounds,
            curve_start: 0,
            curve_count,
            source_start: COMPONENT_GLYPH_FLAG | descriptor_index,
            source_count: 0,
        });

        Ok(glyph_index)
    }
}

pub(super) fn resolve_component_glyph(
    atlas: &VariableAtlas,
    glyph: VariableGlyph,
    weights: &[f32],
) -> Result<Vec<Curve>, SlugError> {
    let descriptor = atlas
        .component_glyphs
        .get(component_glyph_index(glyph).ok_or(SlugError::LengthOverflow)?)
        .ok_or(SlugError::LengthOverflow)?;
    let component_start = descriptor.component_start as usize;
    let component_end = component_start
        .checked_add(descriptor.component_count as usize)
        .ok_or(SlugError::LengthOverflow)?;
    let components = atlas
        .components
        .get(component_start..component_end)
        .ok_or(SlugError::LengthOverflow)?;
    let resolved_transforms = resolve_transforms(atlas, components, weights)?;

    let part_start = descriptor.part_start as usize;
    let part_end = part_start
        .checked_add(descriptor.part_count as usize)
        .ok_or(SlugError::LengthOverflow)?;
    let parts = atlas
        .component_parts
        .get(part_start..part_end)
        .ok_or(SlugError::LengthOverflow)?;
    let mut output = vec![Curve::default(); glyph.curve_count as usize];
    for part in parts {
        let direct_glyph = *atlas
            .glyphs
            .get(part.glyph_index as usize)
            .ok_or(SlugError::GlyphIndexOutOfRange(part.glyph_index))?;
        let transform = if part.component_index == ROOT_COMPONENT {
            Affine::identity()
        } else {
            *resolved_transforms
                .get(part.component_index as usize)
                .ok_or(SlugError::LengthOverflow)?
        };
        let curves = atlas.resolve_glyph_with_weights(part.glyph_index, weights)?;
        let output_start = part.output_curve_start as usize;
        let output_end = output_start
            .checked_add(curves.len())
            .ok_or(SlugError::LengthOverflow)?;
        let destination = output
            .get_mut(output_start..output_end)
            .ok_or(SlugError::LengthOverflow)?;
        for (local_curve, (destination, curve)) in destination.iter_mut().zip(curves).enumerate() {
            let transformed = transform.curve(curve);
            *destination = if atlas.curve_is_line(direct_glyph.curve_start as usize + local_curve) {
                Curve::from_line(transformed.p0, transformed.p2)
            } else {
                transformed
            };
        }
    }
    Ok(output)
}

fn resolve_transforms(
    atlas: &VariableAtlas,
    components: &[VariableComponent],
    weights: &[f32],
) -> Result<Vec<Affine>, SlugError> {
    let mut local_transforms: Vec<Affine> = Vec::with_capacity(components.len());
    let mut resolved_transforms: Vec<Affine> = Vec::with_capacity(components.len());
    for component in components {
        let mut local = component_affine(atlas, *component, weights)?;
        if component.target_component != ROOT_COMPONENT {
            let source_anchor = anchor_point(
                atlas,
                component.source_anchor_start,
                component.source_anchor_count,
                weights,
            )?;
            let target_anchor = anchor_point(
                atlas,
                component.target_anchor_start,
                component.target_anchor_count,
                weights,
            )?;
            let source = local.point(source_anchor);
            let target_transform = *local_transforms
                .get(component.target_component as usize)
                .ok_or(SlugError::LengthOverflow)?;
            let target = target_transform.point(target_anchor);
            local.dx += target.x - source.x;
            local.dy += target.y - source.y;
        }
        let parent = if component.parent_component == ROOT_COMPONENT {
            Affine::identity()
        } else {
            *resolved_transforms
                .get(component.parent_component as usize)
                .ok_or(SlugError::LengthOverflow)?
        };
        local_transforms.push(local);
        resolved_transforms.push(parent.compose(local));
    }
    Ok(resolved_transforms)
}

fn component_affine(
    atlas: &VariableAtlas,
    component: VariableComponent,
    weights: &[f32],
) -> Result<Affine, SlugError> {
    let start = component.source_start as usize;
    let end = start
        .checked_add(component.source_count as usize)
        .ok_or(SlugError::LengthOverflow)?;
    let sources = atlas
        .component_sources
        .get(start..end)
        .ok_or(SlugError::LengthOverflow)?;
    if sources.is_empty() {
        return Err(SlugError::LengthOverflow);
    }

    let mut values = [0.0_f32; 9];
    for source in sources {
        let weight = *weights.get(source.weight_index as usize).ok_or(
            SlugError::VariableWeightIndexOutOfRange(source.weight_index),
        )?;
        for (value, source_value) in values.iter_mut().zip([
            source.translate_x,
            source.translate_y,
            source.rotation,
            source.scale_x,
            source.scale_y,
            source.skew_x,
            source.skew_y,
            source.center_x,
            source.center_y,
        ]) {
            *value += source_value * weight;
        }
    }

    let radians = std::f32::consts::PI / 180.0;
    let (sin_rotation, cos_rotation) = (values[2] * radians).sin_cos();
    let tan_skew_x = (values[5] * radians).tan();
    let tan_skew_y = (values[6] * radians).tan();
    let xx = values[3] * cos_rotation + values[4] * tan_skew_x * sin_rotation;
    let xy = values[3] * sin_rotation - values[4] * tan_skew_x * cos_rotation;
    let yx = -values[4] * sin_rotation + values[3] * tan_skew_y * cos_rotation;
    let yy = values[4] * cos_rotation + values[3] * tan_skew_y * sin_rotation;
    let dx = values[0] + values[7] - (xx * values[7] + yx * values[8]);
    let dy = values[1] + values[8] - (xy * values[7] + yy * values[8]);
    Ok(Affine {
        xx,
        xy,
        yx,
        yy,
        dx,
        dy,
    })
}

fn anchor_point(
    atlas: &VariableAtlas,
    start: u32,
    count: u32,
    weights: &[f32],
) -> Result<Point, SlugError> {
    let start = start as usize;
    let end = start
        .checked_add(count as usize)
        .ok_or(SlugError::LengthOverflow)?;
    let sources = atlas
        .anchor_sources
        .get(start..end)
        .ok_or(SlugError::LengthOverflow)?;
    if sources.is_empty() {
        return Err(SlugError::LengthOverflow);
    }
    sources
        .iter()
        .try_fold(Point::new(0.0, 0.0), |point, source| {
            let weight = *weights.get(source.weight_index as usize).ok_or(
                SlugError::VariableWeightIndexOutOfRange(source.weight_index),
            )?;
            Ok(Point::new(
                point.x + source.x * weight,
                point.y + source.y * weight,
            ))
        })
}

pub(super) fn write_component_glyphs<F>(
    writer: &mut PackedChunkWriter<F>,
    values: &[VariableComponentGlyph],
) where
    F: FnMut(PackedVariableChunk<'_>),
{
    for value in values {
        write_words(
            writer,
            &[
                value.part_start,
                value.part_count,
                value.component_start,
                value.component_count,
                value.root_glyph_index,
                value._padding,
            ],
        );
    }
}

pub(super) fn write_component_parts<F>(
    writer: &mut PackedChunkWriter<F>,
    values: &[VariableComponentPart],
) where
    F: FnMut(PackedVariableChunk<'_>),
{
    for value in values {
        write_words(
            writer,
            &[
                value.glyph_index,
                value.component_index,
                value.output_curve_start,
                value._padding,
            ],
        );
    }
}

pub(super) fn write_components<F>(writer: &mut PackedChunkWriter<F>, values: &[VariableComponent])
where
    F: FnMut(PackedVariableChunk<'_>),
{
    for value in values {
        write_words(
            writer,
            &[
                value.parent_component,
                value.source_start,
                value.source_count,
                value.source_anchor_start,
                value.source_anchor_count,
                value.target_anchor_start,
                value.target_anchor_count,
                value.target_component,
            ],
        );
    }
}

pub(super) fn write_component_sources<F>(
    writer: &mut PackedChunkWriter<F>,
    values: &[VariableComponentSource],
) where
    F: FnMut(PackedVariableChunk<'_>),
{
    for value in values {
        writer.write(&value.weight_index.to_le_bytes());
        for number in [
            value.translate_x,
            value.translate_y,
            value.rotation,
            value.scale_x,
            value.scale_y,
            value.skew_x,
            value.skew_y,
            value.center_x,
            value.center_y,
        ] {
            writer.write(&number.to_le_bytes());
        }
    }
}

pub(super) fn write_anchor_sources<F>(
    writer: &mut PackedChunkWriter<F>,
    values: &[VariableAnchorSource],
) where
    F: FnMut(PackedVariableChunk<'_>),
{
    for value in values {
        writer.write(&value.weight_index.to_le_bytes());
        writer.write(&value.x.to_le_bytes());
        writer.write(&value.y.to_le_bytes());
    }
}

fn write_words<F>(writer: &mut PackedChunkWriter<F>, values: &[u32])
where
    F: FnMut(PackedVariableChunk<'_>),
{
    for value in values {
        writer.write(&value.to_le_bytes());
    }
}
