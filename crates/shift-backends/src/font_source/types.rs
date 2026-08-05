use std::collections::HashSet;

use crate::font_source::FontReadError;
use crate::FontFormat;

macro_rules! index_type {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(u32);

        impl $name {
            pub const fn new(value: u32) -> Self {
                Self(value)
            }

            pub const fn to_u32(self) -> u32 {
                self.0
            }

            pub const fn to_usize(self) -> usize {
                self.0 as usize
            }
        }
    };
}

index_type!(GlyphIndex);
index_type!(AxisIndex);
index_type!(SourceIndex);
index_type!(TrueTypePointIndex);

#[derive(Clone, Debug, PartialEq)]
pub struct DirectoryGlyph {
    pub index: GlyphIndex,
    pub name: String,
    pub unicodes: Box<[u32]>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum VariationAxisKind {
    Continuous {
        minimum: f64,
        default: f64,
        maximum: f64,
    },
    Discrete {
        values: Box<[f64]>,
        default: f64,
    },
}

impl VariationAxisKind {
    pub fn default_value(&self) -> f64 {
        match self {
            Self::Continuous { default, .. } | Self::Discrete { default, .. } => *default,
        }
    }

    fn validate_definition(&self, axis: AxisIndex) -> Result<(), FontReadError> {
        match self {
            Self::Continuous {
                minimum,
                default,
                maximum,
            } => {
                if !minimum.is_finite()
                    || !default.is_finite()
                    || !maximum.is_finite()
                    || minimum > default
                    || default > maximum
                {
                    return Err(FontReadError::InvalidProjection {
                        details: format!("continuous axis {axis:?} has invalid bounds"),
                    });
                }
            }
            Self::Discrete { values, default } => {
                if values.is_empty()
                    || !default.is_finite()
                    || !values.iter().all(|value| value.is_finite())
                    || values.windows(2).any(|pair| pair[0] >= pair[1])
                    || !values.contains(default)
                {
                    return Err(FontReadError::InvalidProjection {
                        details: format!("discrete axis {axis:?} has invalid values"),
                    });
                }
            }
        }
        Ok(())
    }

    pub(crate) fn validate_for_read(
        &self,
        axis: AxisIndex,
        value: f64,
    ) -> Result<(), FontReadError> {
        if !value.is_finite() {
            return Err(FontReadError::NonFiniteCoordinate { axis, value });
        }

        match self {
            Self::Continuous {
                minimum, maximum, ..
            } if value < *minimum || value > *maximum => Err(FontReadError::CoordinateOutOfRange {
                axis,
                value,
                minimum: *minimum,
                maximum: *maximum,
            }),
            Self::Discrete { values, .. } if !values.contains(&value) => {
                Err(FontReadError::CoordinateNotAllowed { axis, value })
            }
            Self::Continuous { .. } | Self::Discrete { .. } => Ok(()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct VariationAxis {
    pub index: AxisIndex,
    pub tag: String,
    pub name: String,
    pub hidden: bool,
    pub kind: VariationAxisKind,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VariationCoordinate {
    pub axis: AxisIndex,
    pub value: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct VariationLocation {
    coordinates: Box<[f64]>,
}

impl VariationLocation {
    pub(crate) fn from_coordinates(coordinates: Vec<f64>) -> Self {
        Self {
            coordinates: coordinates.into_boxed_slice(),
        }
    }

    pub fn coordinates(&self) -> &[f64] {
        &self.coordinates
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FontMetrics {
    pub units_per_em: f64,
    pub ascender: f64,
    pub descender: f64,
    pub line_gap: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DirectorySource {
    pub index: SourceIndex,
    pub name: String,
    /// Internal design-space coordinates ordered like the directory axes.
    pub location: Box<[f64]>,
    pub filename: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DirectoryInstance {
    pub name: String,
    /// External user-space coordinates ordered like the directory axes.
    pub location: Box<[f64]>,
    pub postscript_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DirectoryAxisMapping {
    pub axis: AxisIndex,
    pub points: Box<[(f64, f64)]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FontDirectory {
    pub format: FontFormat,
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub units_per_em: f64,
    pub metrics: FontMetrics,
    pub glyphs: Box<[DirectoryGlyph]>,
    pub axes: Box<[VariationAxis]>,
    pub sources: Box<[DirectorySource]>,
    pub default_source: SourceIndex,
    pub axis_mappings: Box<[DirectoryAxisMapping]>,
    pub instances: Box<[DirectoryInstance]>,
    default_location: VariationLocation,
}

impl FontDirectory {
    pub(crate) fn new(
        format: FontFormat,
        family_name: Option<String>,
        style_name: Option<String>,
        units_per_em: f64,
        glyphs: Vec<DirectoryGlyph>,
        axes: Vec<VariationAxis>,
    ) -> Result<Self, FontReadError> {
        if !units_per_em.is_finite() || units_per_em <= 0.0 {
            return Err(FontReadError::InvalidProjection {
                details: format!("units per em must be positive and finite, got {units_per_em}"),
            });
        }

        for (position, glyph) in glyphs.iter().enumerate() {
            if glyph.index.to_usize() != position {
                return Err(FontReadError::InvalidProjection {
                    details: format!(
                        "glyph directory index {:?} does not match position {position}",
                        glyph.index
                    ),
                });
            }
        }
        let mut axis_tags = HashSet::with_capacity(axes.len());
        for (position, axis) in axes.iter().enumerate() {
            if axis.index.to_usize() != position {
                return Err(FontReadError::InvalidProjection {
                    details: format!(
                        "axis index {:?} does not match position {position}",
                        axis.index
                    ),
                });
            }
            if axis.tag.is_empty() || !axis_tags.insert(axis.tag.as_str()) {
                return Err(FontReadError::InvalidProjection {
                    details: format!("axis {:?} has an empty or duplicate tag", axis.index),
                });
            }
            axis.kind.validate_definition(axis.index)?;
        }

        let default_location = VariationLocation::from_coordinates(
            axes.iter().map(|axis| axis.kind.default_value()).collect(),
        );
        let default_source = DirectorySource {
            index: SourceIndex::new(0),
            name: style_name.clone().unwrap_or_else(|| "Default".into()),
            location: default_location.coordinates.clone(),
            filename: None,
        };
        Ok(Self {
            format,
            family_name,
            style_name,
            units_per_em,
            metrics: FontMetrics {
                units_per_em,
                ascender: units_per_em * 0.8,
                descender: units_per_em * -0.2,
                line_gap: 0.0,
            },
            glyphs: glyphs.into_boxed_slice(),
            axes: axes.into_boxed_slice(),
            sources: vec![default_source].into_boxed_slice(),
            default_source: SourceIndex::new(0),
            axis_mappings: Box::new([]),
            instances: Box::new([]),
            default_location,
        })
    }

    pub(crate) fn set_sources(
        &mut self,
        sources: Vec<DirectorySource>,
        default_source: SourceIndex,
    ) -> Result<(), FontReadError> {
        if sources.is_empty() || default_source.to_usize() >= sources.len() {
            return Err(FontReadError::InvalidProjection {
                details: "font directory has no valid default source".into(),
            });
        }
        for (position, source) in sources.iter().enumerate() {
            if source.index.to_usize() != position
                || source.location.len() != self.axes.len()
                || source.location.iter().any(|value| !value.is_finite())
            {
                return Err(FontReadError::InvalidProjection {
                    details: "font directory source is invalid".into(),
                });
            }
        }
        self.sources = sources.into_boxed_slice();
        self.default_source = default_source;
        Ok(())
    }

    pub(crate) fn set_axis_mappings(&mut self, mappings: Vec<DirectoryAxisMapping>) {
        self.axis_mappings = mappings.into_boxed_slice();
    }

    pub(crate) fn set_instances(&mut self, instances: Vec<DirectoryInstance>) {
        self.instances = instances.into_boxed_slice();
    }

    pub(crate) fn set_metrics(&mut self, metrics: FontMetrics) {
        self.metrics = metrics;
    }

    pub fn default_location(&self) -> &VariationLocation {
        &self.default_location
    }

    pub fn location(
        &self,
        coordinates: &[VariationCoordinate],
    ) -> Result<VariationLocation, FontReadError> {
        let mut values = self.default_location.coordinates.to_vec();
        let mut seen = HashSet::with_capacity(coordinates.len());

        for coordinate in coordinates {
            let Some(axis) = self.axes.get(coordinate.axis.to_usize()) else {
                return Err(FontReadError::UnknownAxis {
                    axis: coordinate.axis,
                });
            };
            if !seen.insert(coordinate.axis) {
                return Err(FontReadError::DuplicateAxis {
                    axis: coordinate.axis,
                });
            }

            axis.kind.validate_for_read(axis.index, coordinate.value)?;
            values[axis.index.to_usize()] = coordinate.value;
        }

        Ok(VariationLocation::from_coordinates(values))
    }
}

/// Column-vector affine transform in y-up design-space font units.
///
/// `x' = xx*x + yx*y + dx` and `y' = xy*x + yy*y + dy`. Finite
/// singular transforms are valid because source components may collapse an axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AffineTransform {
    pub xx: f64,
    pub xy: f64,
    pub yx: f64,
    pub yy: f64,
    pub dx: f64,
    pub dy: f64,
}

impl AffineTransform {
    pub const fn identity() -> Self {
        Self {
            xx: 1.0,
            xy: 0.0,
            yx: 0.0,
            yy: 1.0,
            dx: 0.0,
            dy: 0.0,
        }
    }

    /// Composes transforms as `self ∘ inner`: apply `inner`, then `self`.
    pub fn compose(self, inner: Self) -> Self {
        Self {
            xx: self.xx * inner.xx + self.yx * inner.xy,
            xy: self.xy * inner.xx + self.yy * inner.xy,
            yx: self.xx * inner.yx + self.yx * inner.yy,
            yy: self.xy * inner.yx + self.yy * inner.yy,
            dx: self.xx * inner.dx + self.yx * inner.dy + self.dx,
            dy: self.xy * inner.dx + self.yy * inner.dy + self.dy,
        }
    }

    pub fn transform_point(self, x: f64, y: f64) -> (f64, f64) {
        (
            self.xx * x + self.yx * y + self.dx,
            self.xy * x + self.yy * y + self.dy,
        )
    }

    pub fn is_finite(self) -> bool {
        [self.xx, self.xy, self.yx, self.yy, self.dx, self.dy]
            .into_iter()
            .all(f64::is_finite)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GlyphPointKind {
    OnCurve,
    QuadraticControl,
    CubicControl,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PointProvenance {
    Native {
        ttf_point_index: Option<TrueTypePointIndex>,
    },
    Implied,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphPoint {
    pub x: f64,
    pub y: f64,
    pub kind: GlyphPointKind,
    pub smooth: bool,
    pub provenance: PointProvenance,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphAnchor {
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlyphMetrics {
    pub x_advance: f64,
    pub y_advance: Option<f64>,
}

/// Source structure for one point. Numeric coordinates live in [`GlyphShape::values`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GlyphShapePoint {
    pub kind: GlyphPointKind,
    pub smooth: bool,
    pub provenance: PointProvenance,
}

/// Source structure for one contour in a location-independent projection.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphShapeContour {
    pub points: Box<[GlyphShapePoint]>,
    pub closed: bool,
}

/// One direct component dependency in a location-independent projection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GlyphComponent {
    pub glyph: GlyphIndex,
}

/// Immutable source shape with structure-separated interpolation values.
///
/// Values are ordered as horizontal advance, contour point x/y pairs, anchor
/// x/y pairs, then component affine transforms as xx/xy/yx/yy/dx/dy.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphShape {
    pub contours: Box<[GlyphShapeContour]>,
    pub anchors: Box<[Option<String>]>,
    pub components: Box<[GlyphComponent]>,
    pub values: Box<[f64]>,
}

impl GlyphShape {
    pub fn expected_value_count(&self) -> usize {
        1 + self
            .contours
            .iter()
            .map(|contour| contour.points.len() * 2)
            .sum::<usize>()
            + self.anchors.len() * 2
            + self.components.len() * 6
    }

    pub fn validate(&self) -> Result<(), FontReadError> {
        let expected = self.expected_value_count();
        if self.values.len() != expected {
            return Err(FontReadError::InvalidProjection {
                details: format!(
                    "glyph projection shape has {} values, expected {expected}",
                    self.values.len()
                ),
            });
        }
        if self.values.iter().any(|value| !value.is_finite()) {
            return Err(FontReadError::InvalidProjection {
                details: "glyph projection shape contains a non-finite value".into(),
            });
        }
        for contour in &self.contours {
            if contour.points.is_empty() {
                return Err(FontReadError::InvalidProjection {
                    details: "glyph projection contains an empty contour".into(),
                });
            }
        }
        Ok(())
    }
}

/// One normalized axis support in a source variation region.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VariationSupport {
    pub axis: AxisIndex,
    pub lower: f64,
    pub peak: f64,
    pub upper: f64,
}

/// Product of axis supports controlling one glyph delta vector.
#[derive(Clone, Debug, PartialEq)]
pub struct VariationRegion {
    pub supports: Box<[VariationSupport]>,
}

/// One structure-aligned numeric delta contribution.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphDelta {
    pub region: VariationRegion,
    pub values: Box<[f64]>,
}

/// Location-independent variation over one fallback structure.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphVariation {
    pub deltas: Box<[GlyphDelta]>,
}

/// Exact source shape excluded from compatible interpolation.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphSourceShape {
    pub source: SourceIndex,
    pub shape: GlyphShape,
}

/// One source-local location-independent glyph projection.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphProjection {
    pub glyph: GlyphIndex,
    pub fallback: GlyphShape,
    pub variation: Option<GlyphVariation>,
    pub exact_shapes: Box<[GlyphSourceShape]>,
}

impl GlyphProjection {
    pub fn validate(&self, axis_count: usize, source_count: usize) -> Result<(), FontReadError> {
        self.fallback.validate()?;
        let value_count = self.fallback.values.len();
        if let Some(variation) = &self.variation {
            for delta in &variation.deltas {
                if delta.values.len() != value_count
                    || delta.values.iter().any(|value| !value.is_finite())
                {
                    return Err(FontReadError::InvalidProjection {
                        details: "glyph projection delta values are invalid".into(),
                    });
                }
                for support in &delta.region.supports {
                    if support.axis.to_usize() >= axis_count
                        || ![support.lower, support.peak, support.upper]
                            .into_iter()
                            .all(f64::is_finite)
                        || support.lower > support.peak
                        || support.peak > support.upper
                        || (support.lower < 0.0 && support.upper > 0.0)
                    {
                        return Err(FontReadError::InvalidProjection {
                            details: "glyph projection variation support is invalid".into(),
                        });
                    }
                }
            }
        }
        for exact in &self.exact_shapes {
            if exact.source.to_usize() >= source_count {
                return Err(FontReadError::InvalidProjection {
                    details: "glyph projection exact source is out of range".into(),
                });
            }
            exact.shape.validate()?;
        }
        Ok(())
    }
}

/// Requested glyph projection plus every transitive component projection.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectedGlyph {
    pub root: GlyphProjection,
    pub components: Box<[GlyphProjection]>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> FontDirectory {
        FontDirectory::new(
            FontFormat::Ttf,
            Some("Test".into()),
            Some("Regular".into()),
            1_000.0,
            vec![DirectoryGlyph {
                index: GlyphIndex::new(0),
                name: ".notdef".into(),
                unicodes: Box::new([]),
            }],
            vec![VariationAxis {
                index: AxisIndex::new(0),
                tag: "wght".into(),
                name: "Weight".into(),
                hidden: false,
                kind: VariationAxisKind::Continuous {
                    minimum: 100.0,
                    default: 400.0,
                    maximum: 900.0,
                },
            }],
        )
        .unwrap()
    }

    #[test]
    fn directory_completes_and_validates_external_locations() {
        let directory = directory();
        assert_eq!(directory.default_location().coordinates(), [400.0]);
        assert_eq!(
            directory
                .location(&[VariationCoordinate {
                    axis: AxisIndex::new(0),
                    value: 750.0,
                }])
                .unwrap()
                .coordinates(),
            [750.0]
        );
        assert!(matches!(
            directory.location(&[VariationCoordinate {
                axis: AxisIndex::new(0),
                value: 1_000.0,
            }]),
            Err(FontReadError::CoordinateOutOfRange { .. })
        ));
    }

    #[test]
    fn finite_singular_affine_transform_is_valid() {
        let singular = AffineTransform {
            xx: 0.0,
            yy: 0.0,
            ..AffineTransform::identity()
        };

        assert!(singular.is_finite());
        assert_eq!(singular.transform_point(4.0, 5.0), (0.0, 0.0));
    }

    #[test]
    fn affine_composition_applies_inner_then_outer() {
        let translate = AffineTransform {
            dx: 10.0,
            dy: 20.0,
            ..AffineTransform::identity()
        };
        let scale = AffineTransform {
            xx: 2.0,
            yy: 3.0,
            ..AffineTransform::identity()
        };

        assert_eq!(
            translate.compose(scale).transform_point(4.0, 5.0),
            (18.0, 35.0)
        );
    }
}
