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
index_type!(GeometryIndex);
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
                    return Err(FontReadError::InvalidDisplayGlyph {
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
                    return Err(FontReadError::InvalidDisplayGlyph {
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

#[derive(Clone, Debug, PartialEq)]
pub struct FontDirectory {
    pub format: FontFormat,
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub units_per_em: f64,
    pub glyphs: Box<[DirectoryGlyph]>,
    pub axes: Box<[VariationAxis]>,
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
            return Err(FontReadError::InvalidDisplayGlyph {
                details: format!("units per em must be positive and finite, got {units_per_em}"),
            });
        }

        for (position, glyph) in glyphs.iter().enumerate() {
            if glyph.index.to_usize() != position {
                return Err(FontReadError::InvalidDisplayGlyph {
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
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: format!(
                        "axis index {:?} does not match position {position}",
                        axis.index
                    ),
                });
            }
            if axis.tag.is_empty() || !axis_tags.insert(axis.tag.as_str()) {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: format!("axis {:?} has an empty or duplicate tag", axis.index),
                });
            }
            axis.kind.validate_definition(axis.index)?;
        }

        let default_location = VariationLocation::from_coordinates(
            axes.iter().map(|axis| axis.kind.default_value()).collect(),
        );
        Ok(Self {
            format,
            family_name,
            style_name,
            units_per_em,
            glyphs: glyphs.into_boxed_slice(),
            axes: axes.into_boxed_slice(),
            default_location,
        })
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

macro_rules! range_type {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
        pub struct $name {
            pub start: u32,
            pub count: u32,
        }

        impl $name {
            pub(crate) fn new(start: usize, count: usize) -> Result<Self, FontReadError> {
                let start =
                    u32::try_from(start).map_err(|_| FontReadError::InvalidDisplayGlyph {
                        details: concat!(stringify!($name), " start exceeds u32").into(),
                    })?;
                let count =
                    u32::try_from(count).map_err(|_| FontReadError::InvalidDisplayGlyph {
                        details: concat!(stringify!($name), " count exceeds u32").into(),
                    })?;
                start
                    .checked_add(count)
                    .ok_or_else(|| FontReadError::InvalidDisplayGlyph {
                        details: concat!(stringify!($name), " overflows u32").into(),
                    })?;
                Ok(Self { start, count })
            }

            pub(crate) fn checked_end(self, arena: &str) -> Result<usize, FontReadError> {
                let end = self.start.checked_add(self.count).ok_or_else(|| {
                    FontReadError::InvalidDisplayGlyph {
                        details: format!("{arena} range overflows u32"),
                    }
                })?;
                Ok(end as usize)
            }
        }
    };
}

range_type!(PointRange);
range_type!(ContourRange);
range_type!(ComponentRange);
range_type!(AnchorRange);
range_type!(GuideRange);

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

    fn is_finite(self) -> bool {
        [self.xx, self.xy, self.yx, self.yy, self.dx, self.dy]
            .into_iter()
            .all(f64::is_finite)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphGeometry {
    pub glyph: GlyphIndex,
    pub contours: ContourRange,
    pub components: ComponentRange,
    pub anchors: AnchorRange,
    pub guides: GuideRange,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphContour {
    pub points: PointRange,
    pub closed: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ComponentInstance {
    pub geometry: GeometryIndex,
    pub transform: AffineTransform,
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

#[derive(Clone, Debug, PartialEq)]
pub enum GlyphGuide {
    Horizontal {
        y: f64,
        name: Option<String>,
        color: Option<String>,
    },
    Vertical {
        x: f64,
        name: Option<String>,
        color: Option<String>,
    },
    Angled {
        x: f64,
        y: f64,
        degrees: f64,
        name: Option<String>,
        color: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlyphMetrics {
    pub x_advance: f64,
    pub y_advance: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlyphBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// One selected glyph resolved in design-space font units with a y-up axis.
///
/// The arenas contain only the selected root and its component closure. Every
/// range and graph reference is validated by [`DisplayGlyph::validate`].
#[derive(Clone, Debug, PartialEq)]
pub struct DisplayGlyph {
    pub glyph: GlyphIndex,
    pub location: VariationLocation,
    pub root_geometry: GeometryIndex,
    pub geometries: Box<[GlyphGeometry]>,
    pub contours: Box<[GlyphContour]>,
    pub components: Box<[ComponentInstance]>,
    pub points: Box<[GlyphPoint]>,
    pub anchors: Box<[GlyphAnchor]>,
    pub guides: Box<[GlyphGuide]>,
    pub metrics: GlyphMetrics,
    pub bounds: Option<GlyphBounds>,
}

impl DisplayGlyph {
    pub fn validate(&self) -> Result<(), FontReadError> {
        if self
            .location
            .coordinates
            .iter()
            .any(|value| !value.is_finite())
        {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: "variation location contains a non-finite coordinate".into(),
            });
        }
        let root = self.root_geometry.to_usize();
        if root >= self.geometries.len() {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: format!("root geometry {root} does not exist"),
            });
        }
        if root != 0 {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: "root geometry must be the first geometry".into(),
            });
        }
        if self.geometries[root].glyph != self.glyph {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: "root geometry does not represent the requested glyph".into(),
            });
        }

        let mut glyphs = HashSet::with_capacity(self.geometries.len());
        let mut contour_cursor = 0;
        let mut component_cursor = 0;
        let mut anchor_cursor = 0;
        let mut guide_cursor = 0;
        for geometry in &self.geometries {
            if !glyphs.insert(geometry.glyph) {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: format!("glyph {:?} has duplicate geometries", geometry.glyph),
                });
            }
            check_partition(
                geometry.contours.start,
                geometry.contours.checked_end("contour")?,
                &mut contour_cursor,
                self.contours.len(),
                "contour",
            )?;
            check_partition(
                geometry.components.start,
                geometry.components.checked_end("component")?,
                &mut component_cursor,
                self.components.len(),
                "component",
            )?;
            check_partition(
                geometry.anchors.start,
                geometry.anchors.checked_end("anchor")?,
                &mut anchor_cursor,
                self.anchors.len(),
                "anchor",
            )?;
            check_partition(
                geometry.guides.start,
                geometry.guides.checked_end("guide")?,
                &mut guide_cursor,
                self.guides.len(),
                "guide",
            )?;
        }
        check_partition_end(contour_cursor, self.contours.len(), "contour")?;
        check_partition_end(component_cursor, self.components.len(), "component")?;
        check_partition_end(anchor_cursor, self.anchors.len(), "anchor")?;
        check_partition_end(guide_cursor, self.guides.len(), "guide")?;

        let mut point_cursor = 0;
        for contour in &self.contours {
            let end = contour.points.checked_end("point")?;
            check_partition(
                contour.points.start,
                end,
                &mut point_cursor,
                self.points.len(),
                "point",
            )?;
            if contour.points.count == 0 {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "empty contour records are not canonical".into(),
                });
            }
            validate_point_sequence(
                &self.points[contour.points.start as usize..end],
                contour.closed,
            )?;
        }
        check_partition_end(point_cursor, self.points.len(), "point")?;

        for component in &self.components {
            if component.geometry.to_usize() >= self.geometries.len() {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: format!("component geometry {:?} does not exist", component.geometry),
                });
            }
            if !component.transform.is_finite() {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "component transform contains a non-finite value".into(),
                });
            }
        }

        for point in &self.points {
            if !point.x.is_finite() || !point.y.is_finite() {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "point contains a non-finite coordinate".into(),
                });
            }
            if point.provenance == PointProvenance::Implied
                && (point.kind != GlyphPointKind::OnCurve || point.smooth)
            {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "implied points must be non-smooth on-curve points".into(),
                });
            }
        }

        for anchor in &self.anchors {
            if !anchor.x.is_finite() || !anchor.y.is_finite() {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "anchor contains a non-finite coordinate".into(),
                });
            }
        }
        for guide in &self.guides {
            let finite = match guide {
                GlyphGuide::Horizontal { y, .. } => y.is_finite(),
                GlyphGuide::Vertical { x, .. } => x.is_finite(),
                GlyphGuide::Angled { x, y, degrees, .. } => {
                    x.is_finite() && y.is_finite() && degrees.is_finite()
                }
            };
            if !finite {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "guide contains a non-finite value".into(),
                });
            }
        }

        if !self.metrics.x_advance.is_finite()
            || self
                .metrics
                .y_advance
                .is_some_and(|value| !value.is_finite())
        {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: "glyph metrics contain a non-finite value".into(),
            });
        }
        if let Some(bounds) = self.bounds {
            if ![bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y]
                .into_iter()
                .all(f64::is_finite)
                || bounds.min_x > bounds.max_x
                || bounds.min_y > bounds.max_y
            {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "glyph bounds are invalid".into(),
                });
            }
        }

        self.validate_graph()
    }

    fn validate_graph(&self) -> Result<(), FontReadError> {
        let mut states = vec![0_u8; self.geometries.len()];
        self.visit_geometry(self.root_geometry.to_usize(), &mut states)?;
        if states.contains(&0) {
            return Err(FontReadError::InvalidDisplayGlyph {
                details: "display glyph contains unreachable geometry".into(),
            });
        }
        Ok(())
    }

    fn visit_geometry(&self, index: usize, states: &mut [u8]) -> Result<(), FontReadError> {
        match states[index] {
            1 => {
                return Err(FontReadError::InvalidDisplayGlyph {
                    details: "display glyph component graph contains a cycle".into(),
                })
            }
            2 => return Ok(()),
            _ => states[index] = 1,
        }

        let geometry = &self.geometries[index];
        let start = geometry.components.start as usize;
        let end = geometry.components.checked_end("component")?;
        for component in &self.components[start..end] {
            self.visit_geometry(component.geometry.to_usize(), states)?;
        }
        states[index] = 2;
        Ok(())
    }
}

fn check_partition(
    start: u32,
    end: usize,
    cursor: &mut usize,
    arena_len: usize,
    arena: &str,
) -> Result<(), FontReadError> {
    if start as usize != *cursor || start as usize > end || end > arena_len {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: format!(
                "{arena} range {start}..{end} does not continue canonical partition at {} of {arena_len}",
                *cursor
            ),
        });
    }
    *cursor = end;
    Ok(())
}

fn check_partition_end(cursor: usize, arena_len: usize, arena: &str) -> Result<(), FontReadError> {
    if cursor != arena_len {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: format!("{arena} partition ends at {cursor}, not arena length {arena_len}"),
        });
    }
    Ok(())
}

fn validate_point_sequence(points: &[GlyphPoint], closed: bool) -> Result<(), FontReadError> {
    if points[0].kind != GlyphPointKind::OnCurve {
        return Err(FontReadError::InvalidDisplayGlyph {
            details: "contour does not begin on-curve".into(),
        });
    }
    let limit = if closed {
        points.len() + 1
    } else {
        points.len()
    };
    let mut cursor = 1;
    while cursor < limit {
        match points[cursor % points.len()].kind {
            GlyphPointKind::OnCurve => cursor += 1,
            GlyphPointKind::QuadraticControl => {
                if cursor + 1 >= limit
                    || points[(cursor + 1) % points.len()].kind != GlyphPointKind::OnCurve
                {
                    return Err(FontReadError::InvalidDisplayGlyph {
                        details: "quadratic control is not followed by an endpoint".into(),
                    });
                }
                cursor += 2;
            }
            GlyphPointKind::CubicControl => {
                if cursor + 2 >= limit
                    || points[(cursor + 1) % points.len()].kind != GlyphPointKind::CubicControl
                    || points[(cursor + 2) % points.len()].kind != GlyphPointKind::OnCurve
                {
                    return Err(FontReadError::InvalidDisplayGlyph {
                        details: "invalid cubic point sequence".into(),
                    });
                }
                cursor += 3;
            }
        }
    }
    Ok(())
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
