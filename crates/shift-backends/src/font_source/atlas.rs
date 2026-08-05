use std::collections::HashMap;

use shift_slug::VariableAtlas;
use skrifa::raw::types::F2Dot14;

use crate::font_source::{
    FontReadError, GlyphIndex, SourceIndex, VariationAxis, VariationLocation,
};

/// A location-independent Slug page compiled directly from retained source semantics.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceAtlasPage {
    atlas: VariableAtlas,
    descriptor: SourceAtlasDescriptor,
}

impl SourceAtlasPage {
    pub(crate) fn new(
        atlas: VariableAtlas,
        glyphs: Vec<(GlyphIndex, u32)>,
        exact_glyphs: Vec<(GlyphIndex, SourceIndex, u32)>,
        axes: Vec<AtlasAxis>,
        regions: Vec<AtlasRegion>,
        complements: Vec<Box<[u32]>>,
    ) -> Self {
        Self {
            atlas,
            descriptor: SourceAtlasDescriptor {
                glyphs: glyphs.into_boxed_slice(),
                exact_glyphs: exact_glyphs.into_boxed_slice(),
                axes: axes.into_boxed_slice(),
                regions: regions.into_boxed_slice(),
                complements: complements.into_boxed_slice(),
            },
        }
    }

    pub fn atlas(&self) -> &VariableAtlas {
        &self.atlas
    }

    pub fn glyphs(&self) -> &[(GlyphIndex, u32)] {
        self.descriptor.glyphs()
    }

    pub fn exact_glyphs(&self) -> &[(GlyphIndex, SourceIndex, u32)] {
        self.descriptor.exact_glyphs()
    }

    /// Evaluates the small page-local weight buffer without rebuilding resident geometry.
    pub fn weights(&self, location: &VariationLocation) -> Result<Vec<f32>, SourceAtlasError> {
        self.descriptor.weights(location)
    }

    /// Separates disposable CPU atlas geometry from its small retained descriptor.
    pub fn into_parts(self) -> (VariableAtlas, SourceAtlasDescriptor) {
        (self.atlas, self.descriptor)
    }
}

/// Small retained mapping needed after a source atlas has been packed and uploaded.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceAtlasDescriptor {
    glyphs: Box<[(GlyphIndex, u32)]>,
    exact_glyphs: Box<[(GlyphIndex, SourceIndex, u32)]>,
    axes: Box<[AtlasAxis]>,
    regions: Box<[AtlasRegion]>,
    complements: Box<[Box<[u32]>]>,
}

impl SourceAtlasDescriptor {
    pub fn glyphs(&self) -> &[(GlyphIndex, u32)] {
        &self.glyphs
    }

    pub fn exact_glyphs(&self) -> &[(GlyphIndex, SourceIndex, u32)] {
        &self.exact_glyphs
    }

    /// Evaluates the small page-local weight buffer without resident CPU geometry.
    pub fn weights(&self, location: &VariationLocation) -> Result<Vec<f32>, SourceAtlasError> {
        if location.coordinates().len() != self.axes.len() {
            return Err(FontReadError::InvalidProjection {
                details: format!(
                    "location has {} coordinates for {} source atlas axes",
                    location.coordinates().len(),
                    self.axes.len()
                ),
            }
            .into());
        }

        let coordinates = self
            .axes
            .iter()
            .zip(location.coordinates())
            .map(|(axis, value)| axis.normalize(*value))
            .collect::<Result<Vec<_>, _>>()?;
        let mut weights = Vec::with_capacity(
            1_usize
                .checked_add(self.regions.len())
                .and_then(|length| length.checked_add(self.complements.len()))
                .ok_or(shift_slug::SlugError::LengthOverflow)?,
        );
        weights.push(1.0);
        for region in &self.regions {
            weights.push(region.scalar(&coordinates)?);
        }
        for complement in &self.complements {
            let region_sum = complement.iter().try_fold(0.0_f32, |sum, index| {
                let weight = weights
                    .get(*index as usize)
                    .ok_or(shift_slug::SlugError::VariableWeightIndexOutOfRange(*index))?;
                Ok::<_, shift_slug::SlugError>(sum + weight)
            })?;
            weights.push(1.0 - region_sum);
        }
        Ok(weights)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SourceAtlasError {
    #[error(transparent)]
    Read(#[from] FontReadError),

    #[error(transparent)]
    Slug(#[from] shift_slug::SlugError),

    #[error("unsupported binary atlas source: {details}")]
    UnsupportedBinary { details: &'static str },
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AtlasAxis {
    axis: VariationAxis,
    user_mapping: Box<[(f64, f64)]>,
    minimum: f64,
    default: f64,
    maximum: f64,
    normalized_mapping: Box<[(i16, i16)]>,
}

impl AtlasAxis {
    pub(crate) fn new(
        axis: VariationAxis,
        user_mapping: Vec<(f64, f64)>,
        minimum: f64,
        default: f64,
        maximum: f64,
        normalized_mapping: Vec<(i16, i16)>,
    ) -> Self {
        Self {
            axis,
            user_mapping: user_mapping.into_boxed_slice(),
            minimum,
            default,
            maximum,
            normalized_mapping: normalized_mapping.into_boxed_slice(),
        }
    }

    fn normalize(&self, value: f64) -> Result<i16, FontReadError> {
        self.axis.kind.validate_for_read(self.axis.index, value)?;
        self.normalize_internal(map_value(value, &self.user_mapping))
    }

    pub(crate) fn normalize_internal(&self, value: f64) -> Result<i16, FontReadError> {
        if !value.is_finite() {
            return Err(FontReadError::NonFiniteCoordinate {
                axis: self.axis.index,
                value,
            });
        }
        let normalized = if value == self.default {
            0.0
        } else if value < self.default {
            if self.default == self.minimum {
                0.0
            } else {
                (value - self.default) / (self.default - self.minimum)
            }
        } else if self.maximum == self.default {
            0.0
        } else {
            (value - self.default) / (self.maximum - self.default)
        };
        let coordinate = F2Dot14::from_f32(normalized as f32).to_bits();
        Ok(apply_mapping(coordinate, &self.normalized_mapping))
    }
}

fn map_value(value: f64, points: &[(f64, f64)]) -> f64 {
    match points {
        [] => value,
        [point] => point.1,
        _ => {
            let upper = points.partition_point(|point| point.0 < value);
            let [left, right] = if upper == 0 {
                [points[0], points[1]]
            } else if upper == points.len() {
                [points[points.len() - 2], points[points.len() - 1]]
            } else {
                [points[upper - 1], points[upper]]
            };
            if left.0 == right.0 {
                return left.1;
            }
            left.1 + (right.1 - left.1) * (value - left.0) / (right.0 - left.0)
        }
    }
}

fn apply_mapping(coordinate: i16, mapping: &[(i16, i16)]) -> i16 {
    let Some(position) = mapping.iter().position(|(source, _)| *source >= coordinate) else {
        return coordinate;
    };
    let (source, target) = mapping[position];
    if source == coordinate {
        return target;
    }
    let Some(&(previous_source, previous_target)) = position
        .checked_sub(1)
        .and_then(|previous| mapping.get(previous))
    else {
        return coordinate;
    };
    if source == previous_source {
        return previous_target;
    }
    let fraction = f64::from(i32::from(coordinate) - i32::from(previous_source))
        / f64::from(i32::from(source) - i32::from(previous_source));
    let mapped = f64::from(previous_target)
        + f64::from(i32::from(target) - i32::from(previous_target)) * fraction;
    F2Dot14::from_f32(mapped as f32 / 16384.0).to_bits()
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct AtlasRegion {
    axes: Box<[RegionAxis]>,
}

impl AtlasRegion {
    pub(crate) fn new(axes: Vec<RegionAxis>) -> Self {
        Self {
            axes: axes.into_boxed_slice(),
        }
    }

    pub(crate) fn axes(&self) -> &[RegionAxis] {
        &self.axes
    }

    pub(crate) fn scalar(&self, coordinates: &[i16]) -> Result<f32, SourceAtlasError> {
        if self.axes.len() != coordinates.len() {
            return Err(FontReadError::InvalidProjection {
                details: format!(
                    "source atlas region has {} axes for {} coordinates",
                    self.axes.len(),
                    coordinates.len()
                ),
            }
            .into());
        }
        let mut scalar = 1.0_f32;
        for (axis, coordinate) in self.axes.iter().zip(coordinates) {
            let start = i32::from(axis.start);
            let peak = i32::from(axis.peak);
            let end = i32::from(axis.end);
            let coordinate = i32::from(*coordinate);
            if peak == 0 || peak == coordinate {
                continue;
            }
            if start > peak || peak > end || (start < 0 && end > 0) {
                continue;
            }
            if coordinate < start || coordinate > end {
                return Ok(0.0);
            }
            if coordinate < peak {
                if peak != start {
                    scalar *= (coordinate - start) as f32 / (peak - start) as f32;
                }
            } else if peak != end {
                scalar *= (end - coordinate) as f32 / (end - peak) as f32;
            }
        }
        Ok(scalar)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct RegionAxis {
    pub(crate) start: i16,
    pub(crate) peak: i16,
    pub(crate) end: i16,
}

#[derive(Debug, Default)]
pub(crate) struct RegionRegistry {
    regions: Vec<AtlasRegion>,
    indices: HashMap<AtlasRegion, u32>,
}

impl RegionRegistry {
    pub(crate) fn weight_index(&mut self, region: AtlasRegion) -> Result<u32, SourceAtlasError> {
        if let Some(index) = self.indices.get(&region) {
            return Ok(*index);
        }
        let index = u32::try_from(self.regions.len())
            .map_err(|_| shift_slug::SlugError::LengthOverflow)?
            .checked_add(1)
            .ok_or(shift_slug::SlugError::LengthOverflow)?;
        self.regions.push(region.clone());
        self.indices.insert(region, index);
        Ok(index)
    }

    pub(crate) fn len(&self) -> usize {
        self.regions.len()
    }

    pub(crate) fn regions(&self) -> &[AtlasRegion] {
        &self.regions
    }

    pub(crate) fn into_regions(self) -> Vec<AtlasRegion> {
        self.regions
    }
}

#[cfg(test)]
mod tests {
    use shift_slug::VariableAtlas;

    use super::{AtlasAxis, AtlasRegion, RegionAxis, SourceAtlasPage};
    use crate::font_source::{AxisIndex, VariationAxis, VariationAxisKind, VariationLocation};

    #[test]
    fn page_weights_keep_glyph_region_complements_independent() {
        let axis = VariationAxis {
            index: AxisIndex::new(0),
            tag: "wght".into(),
            name: "Weight".into(),
            hidden: false,
            kind: VariationAxisKind::Continuous {
                minimum: -1.0,
                default: 0.0,
                maximum: 1.0,
            },
        };
        let page = SourceAtlasPage::new(
            VariableAtlas::default(),
            Vec::new(),
            Vec::new(),
            vec![AtlasAxis::new(axis, Vec::new(), -1.0, 0.0, 1.0, Vec::new())],
            vec![
                AtlasRegion::new(vec![RegionAxis {
                    start: 0,
                    peak: 16384,
                    end: 16384,
                }]),
                AtlasRegion::new(vec![RegionAxis {
                    start: -16384,
                    peak: -16384,
                    end: 0,
                }]),
            ],
            vec![vec![1].into_boxed_slice(), vec![2].into_boxed_slice()],
        );

        let (atlas, descriptor) = page.into_parts();

        assert_eq!(atlas, VariableAtlas::default());
        assert_eq!(
            descriptor
                .weights(&VariationLocation::from_coordinates(vec![1.0]))
                .unwrap(),
            vec![1.0, 1.0, 0.0, 0.0, 1.0]
        );
    }
}
