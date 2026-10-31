//! Stable `shift-font` point/segment topologies for resident Slug geometry.
//!
//! Production variation must not pair independently resolved outline callbacks:
//! command kinds can change when geometry becomes degenerate. This module builds
//! one topology from the interpolation reference layer, then evaluates every
//! compatible source through the same contour, point, and segment indexes.

use crate::numeric::lossy_f32;
use shift_font::Require;
use std::{collections::HashMap, error::Error, fmt};

use shift_font::{
    Contour, ContourId, CoreError, CurveSegment, CurveSegmentIter, Font, GlyphLayer,
    GlyphProjection, GlyphProjectionSet, Point as FontPoint, PointId, PointType, SourceId,
    composite::ResolvedContour,
};

use crate::{
    AuthoredAtlasProfile, Curve, CurveShape, GlyphIndex, Point, QuadraticOutline, SlugError,
    VariableAtlasBuilder,
};

mod component;
pub use component::{AuthoredWeightSet, add_authored_glyph_with_weight_sets};

pub(crate) type AuthoredDefaultKey = (shift_font::GlyphId, Vec<u32>, u32);
pub(crate) type AuthoredDefaultGlyphs = HashMap<AuthoredDefaultKey, GlyphIndex>;

/// Borrowed inputs for compiling one authored root glyph.
///
/// The compilation mutates only phase timings. It owns no cache and is dropped
/// after the root; resolved source glyphs remain in a separate root-local map.
pub(super) struct AuthoredGlyphCompilation<'a, 'profile> {
    font: &'a Font,
    projection_set: &'a GlyphProjectionSet,
    weight_sets: &'a [AuthoredWeightSet],
    constant_weight_index: u32,
    profile: &'profile mut AuthoredAtlasProfile,
}

/// Product semantics that the first authored contour adapter cannot yet encode.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AuthoredGlyphRequirements {
    pub component_occurrences: usize,
    pub exact_source_shapes: usize,
    pub exact_component_variants: usize,
}

impl AuthoredGlyphRequirements {
    pub fn is_supported(self) -> bool {
        self == Self::default()
    }
}

/// Resident atlas glyphs selected by one authored glyph projection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthoredGlyph {
    pub default_glyph: GlyphIndex,
    pub exact_sources: Vec<AuthoredSourceGlyph>,
}

impl AuthoredGlyph {
    /// Selects an exact-source topology or the compatible default glyph.
    pub fn glyph_for_source(&self, source_id: Option<&SourceId>) -> GlyphIndex {
        source_id
            .and_then(|source_id| {
                self.exact_sources
                    .iter()
                    .find(|source| source.source_id == *source_id)
            })
            .map_or(self.default_glyph, |source| source.glyph_index)
    }
}

/// One source-specific resident glyph whose topology is not interpolated.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthoredSourceGlyph {
    pub source_id: SourceId,
    pub glyph_index: GlyphIndex,
}

/// One location-independent authored atlas generation.
///
/// Direct geometry is deduplicated only within this explicit generation. Drop
/// the builder and start another generation after authored edits so no stale
/// geometry can be selected by stable identity alone.
#[derive(Debug)]
pub struct AuthoredAtlasBuilder {
    builder: VariableAtlasBuilder,
    defaults: AuthoredDefaultGlyphs,
}

impl AuthoredAtlasBuilder {
    /// Starts an authored atlas whose glyphs each split into `band_count` bands.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::InvalidBandCount`] when `band_count` is zero or above
    /// [`crate::MAX_BAND_COUNT`].
    pub fn new(band_count: u32) -> Result<Self, SlugError> {
        Ok(Self {
            builder: VariableAtlasBuilder::new(band_count)?,
            defaults: HashMap::new(),
        })
    }

    /// Adds an identity-preserving blank for an authored glyph without layers.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredSlugError::Slug`] when the atlas outgrows `u32` indices.
    pub fn add_empty_glyph(
        &mut self,
        constant_weight_index: u32,
    ) -> Result<AuthoredGlyph, AuthoredSlugError> {
        let default_glyph = self.builder.add_outline_glyph(
            QuadraticOutline::default(),
            constant_weight_index,
            std::iter::empty(),
        )?;
        Ok(AuthoredGlyph {
            default_glyph,
            exact_sources: Vec::new(),
        })
    }

    /// Adds `projection`'s glyph, its components and its exact-source variants.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredSlugError::Core`] when the glyph or a component cannot be projected,
    /// [`AuthoredSlugError::MissingWeightBasis`] when no weight set matches a glyph's basis, a
    /// topology or finiteness error when a source does not match its default, and
    /// [`AuthoredSlugError::Slug`] when the atlas outgrows its limits.
    pub fn add_glyph(
        &mut self,
        font: &Font,
        projection: &GlyphProjection,
        weight_sets: &[AuthoredWeightSet],
        constant_weight_index: u32,
    ) -> Result<AuthoredGlyph, AuthoredSlugError> {
        let glyph_id = projection.glyph_id();
        let projection_set = font.glyph_projection_set(std::slice::from_ref(&glyph_id))?;
        let projection = projection_set.projection(glyph_id).require(&glyph_id)?;
        self.add_glyph_from_projection_set(
            font,
            &projection_set,
            projection,
            weight_sets,
            constant_weight_index,
        )
    }

    pub(crate) fn add_glyph_from_projection_set(
        &mut self,
        font: &Font,
        projection_set: &GlyphProjectionSet,
        projection: &GlyphProjection,
        weight_sets: &[AuthoredWeightSet],
        constant_weight_index: u32,
    ) -> Result<AuthoredGlyph, AuthoredSlugError> {
        self.add_glyph_from_projection_set_profiled(
            font,
            projection_set,
            projection,
            weight_sets,
            constant_weight_index,
            &mut AuthoredAtlasProfile::default(),
        )
    }

    pub(crate) fn add_glyph_from_projection_set_profiled(
        &mut self,
        font: &Font,
        projection_set: &GlyphProjectionSet,
        projection: &GlyphProjection,
        weight_sets: &[AuthoredWeightSet],
        constant_weight_index: u32,
        profile: &mut AuthoredAtlasProfile,
    ) -> Result<AuthoredGlyph, AuthoredSlugError> {
        let checkpoint = self.builder.checkpoint();
        let mut inserted_defaults = Vec::new();
        let mut compilation = AuthoredGlyphCompilation {
            font,
            projection_set,
            weight_sets,
            constant_weight_index,
            profile,
        };
        match component::add_authored_glyph_with_weight_sets_cached(
            &mut self.builder,
            &mut self.defaults,
            &mut inserted_defaults,
            &mut compilation,
            projection,
        ) {
            Ok(glyph) => Ok(glyph),
            Err(error) => {
                self.builder.rollback(checkpoint);
                for key in inserted_defaults {
                    self.defaults.remove(&key);
                }
                Err(error)
            }
        }
    }

    pub fn finish(self) -> crate::VariableAtlas {
        self.builder.finish()
    }
}

impl Default for AuthoredAtlasBuilder {
    fn default() -> Self {
        Self::new(crate::DEFAULT_BAND_COUNT).expect("default Slug band count is valid")
    }
}

/// Failure while deriving resident Slug curves from canonical authored layers.
#[derive(Debug)]
pub enum AuthoredSlugError {
    UnsupportedGlyph(AuthoredGlyphRequirements),
    MissingInterpolationSources,
    MissingSourceLocation(SourceId),
    ComponentBasisMismatch,
    MissingWeightBasis(shift_font::GlyphId),
    NonFiniteComponentValue {
        component_index: usize,
        source_index: usize,
        kind: &'static str,
    },
    WeightCountMismatch {
        expected: usize,
        actual: usize,
    },
    ContourCountMismatch {
        expected: usize,
        actual: usize,
    },
    ContourTopologyMismatch {
        contour_index: usize,
    },
    NonFiniteCoordinate {
        contour_index: usize,
        point_index: usize,
    },
    NonFiniteAdvance {
        source_index: usize,
    },
    Core(CoreError),
    Slug(SlugError),
}

impl fmt::Display for AuthoredSlugError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedGlyph(requirements) => write!(
                formatter,
                "authored Slug adapter does not yet support {} component occurrences, {} exact-source shapes, and {} exact component variants",
                requirements.component_occurrences,
                requirements.exact_source_shapes,
                requirements.exact_component_variants,
            ),
            Self::MissingInterpolationSources => {
                formatter.write_str("authored glyph interpolation has no compatible sources")
            }
            Self::MissingSourceLocation(source_id) => {
                write!(
                    formatter,
                    "authored source {source_id} has no font location"
                )
            }
            Self::ComponentBasisMismatch => formatter
                .write_str("component interpolation basis differs from the root glyph basis"),
            Self::MissingWeightBasis(glyph_id) => write!(
                formatter,
                "component glyph {glyph_id} uses an interpolation basis without GPU weight indexes"
            ),
            Self::NonFiniteComponentValue {
                component_index,
                source_index,
                kind,
            } => write!(
                formatter,
                "component occurrence {component_index} {kind} source {source_index} is not a finite f32 value"
            ),
            Self::WeightCountMismatch { expected, actual } => write!(
                formatter,
                "authored glyph needs {expected} source weight indexes, got {actual}"
            ),
            Self::ContourCountMismatch { expected, actual } => write!(
                formatter,
                "authored Slug topology needs {expected} contours, got {actual}"
            ),
            Self::ContourTopologyMismatch { contour_index } => write!(
                formatter,
                "authored contour {contour_index} no longer matches its Slug point/segment topology"
            ),
            Self::NonFiniteCoordinate {
                contour_index,
                point_index,
            } => write!(
                formatter,
                "authored contour {contour_index} point {point_index} is not a finite f32 coordinate"
            ),
            Self::NonFiniteAdvance { source_index } => write!(
                formatter,
                "authored source {source_index} advance is not a finite f32 value"
            ),
            Self::Core(error) => error.fmt(formatter),
            Self::Slug(error) => error.fmt(formatter),
        }
    }
}

impl Error for AuthoredSlugError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Core(error) => Some(error),
            Self::Slug(error) => Some(error),
            _ => None,
        }
    }
}

impl From<CoreError> for AuthoredSlugError {
    fn from(error: CoreError) -> Self {
        Self::Core(error)
    }
}

impl From<SlugError> for AuthoredSlugError {
    fn from(error: SlugError) -> Self {
        Self::Slug(error)
    }
}

/// A location-independent quadratic conversion topology tied to authored points.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthoredCurveTopology {
    curves: CurveTopology,
    identities: Vec<ContourIdentity>,
}

/// The ids an authored contour must keep for its topology to apply.
#[derive(Clone, Debug, Eq, PartialEq)]
struct ContourIdentity {
    contour_id: ContourId,
    point_ids: Vec<PointId>,
}

impl ContourIdentity {
    fn of(contour: &Contour) -> Self {
        Self {
            contour_id: contour.id(),
            point_ids: contour.points().iter().map(FontPoint::id).collect(),
        }
    }

    fn matches(&self, contour: &Contour) -> bool {
        contour.id() == self.contour_id
            && contour
                .points()
                .iter()
                .map(FontPoint::id)
                .eq(self.point_ids.iter().cloned())
    }
}

/// Segment-to-point correspondence for a set of contours, shared by every
/// compatible source of one glyph.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CurveTopology {
    contours: Vec<ContourTopology>,
    curve_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContourTopology {
    closed: bool,
    point_types: Vec<PointType>,
    segments: Vec<SegmentTopology>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SegmentTopology {
    Line([usize; 2]),
    Quad([usize; 3]),
    Cubic {
        points: [usize; 4],
        subdivision_count: usize,
    },
}

/// A contour a topology can read: its points and whether it closes.
pub(crate) trait ContourPoints {
    fn contour_points(&self) -> &[FontPoint];
    fn closes(&self) -> bool;

    /// Converts the contour's points, rejecting non-finite coordinates.
    fn slug_points(&self, contour_index: usize) -> Result<Vec<Point>, AuthoredSlugError> {
        self.contour_points()
            .iter()
            .enumerate()
            .map(|(point_index, point)| slug_point(point, contour_index, point_index))
            .collect()
    }
}

impl<C: ContourPoints> ContourPoints for &C {
    fn contour_points(&self) -> &[FontPoint] {
        (**self).contour_points()
    }

    fn closes(&self) -> bool {
        (**self).closes()
    }
}

impl ContourPoints for Contour {
    fn contour_points(&self) -> &[FontPoint] {
        self.points()
    }

    fn closes(&self) -> bool {
        self.is_closed()
    }
}

impl ContourPoints for ResolvedContour {
    fn contour_points(&self) -> &[FontPoint] {
        &self.points
    }

    fn closes(&self) -> bool {
        self.closed
    }
}

impl SegmentTopology {
    /// Records which of `points` a segment of their contour uses.
    fn of(points: &[FontPoint], segment: &CurveSegment<'_>) -> Self {
        let index = |target: &FontPoint| {
            points
                .iter()
                .position(|point| std::ptr::eq(point, target))
                .expect("curve segment points borrow their source contour")
        };
        match segment {
            CurveSegment::Line(p0, p1) => Self::Line([index(p0), index(p1)]),
            CurveSegment::Quad(p0, p1, p2) => Self::Quad([index(p0), index(p1), index(p2)]),
            CurveSegment::Cubic(p0, p1, p2, p3) => Self::Cubic {
                points: [index(p0), index(p1), index(p2), index(p3)],
                subdivision_count: Curve::cubic_subdivision_count(
                    slug_point_unchecked(p0),
                    slug_point_unchecked(p1),
                    slug_point_unchecked(p2),
                    slug_point_unchecked(p3),
                ),
            },
        }
    }

    fn start(self) -> usize {
        match self {
            Self::Line(points) => points[0],
            Self::Quad(points) => points[0],
            Self::Cubic { points, .. } => points[0],
        }
    }

    fn end(self) -> usize {
        match self {
            Self::Line(points) => points[1],
            Self::Quad(points) => points[2],
            Self::Cubic { points, .. } => points[3],
        }
    }

    fn curve_count(self) -> usize {
        match self {
            Self::Cubic {
                subdivision_count, ..
            } => subdivision_count,
            Self::Line(_) | Self::Quad(_) => 1,
        }
    }

    /// Returns the shape of each output quadratic.
    fn curve_shapes(self) -> impl Iterator<Item = CurveShape> {
        let shape = match self {
            Self::Line(_) => CurveShape::Line,
            Self::Quad(_) | Self::Cubic { .. } => CurveShape::Quadratic,
        };
        std::iter::repeat_n(shape, self.curve_count())
    }

    /// Raises a cubic's subdivision count to what `points` need.
    ///
    /// Returns `None` when the segment indexes past `points`.
    fn widen_subdivisions(&mut self, points: &[Point]) -> Option<()> {
        let Self::Cubic {
            points: [p0, p1, p2, p3],
            subdivision_count,
        } = self
        else {
            return Some(());
        };
        let count = Curve::cubic_subdivision_count(
            *points.get(*p0)?,
            *points.get(*p1)?,
            *points.get(*p2)?,
            *points.get(*p3)?,
        );
        *subdivision_count = (*subdivision_count).max(count);
        Some(())
    }

    fn append_curves(self, curves: &mut Vec<Curve>, points: &[Point]) {
        match self {
            Self::Line([p0, p1]) => {
                curves.push(Curve::from_line(points[p0], points[p1]));
            }
            Self::Quad([p0, p1, p2]) => curves.push(Curve {
                p0: points[p0],
                p1: points[p1],
                p2: points[p2],
            }),
            Self::Cubic {
                points: [p0, p1, p2, p3],
                subdivision_count,
            } => curves.extend(Curve::from_cubic_with_subdivisions(
                points[p0],
                points[p1],
                points[p2],
                points[p3],
                subdivision_count,
            )),
        }
    }
}

impl ContourTopology {
    fn of(contour: &impl ContourPoints) -> Self {
        let points = contour.contour_points();
        let mut segments = CurveSegmentIter::new(points, contour.closes())
            .map(|segment| SegmentTopology::of(points, &segment))
            .collect::<Vec<_>>();
        if let (Some(first), Some(last)) = (segments.first().copied(), segments.last().copied()) {
            let start = first.start();
            let end = last.end();
            if start != end {
                segments.push(SegmentTopology::Line([end, start]));
            }
        }
        Self {
            closed: contour.closes(),
            point_types: points.iter().map(FontPoint::point_type).collect(),
            segments,
        }
    }

    /// Returns whether `contour` has this topology's closure and point kinds.
    fn matches(&self, contour: &impl ContourPoints) -> bool {
        contour.closes() == self.closed
            && contour
                .contour_points()
                .iter()
                .map(FontPoint::point_type)
                .eq(self.point_types.iter().copied())
    }
}

impl CurveTopology {
    fn from_contours<'a, C: ContourPoints + 'a>(contours: impl IntoIterator<Item = &'a C>) -> Self {
        let mut topology = Self {
            contours: contours.into_iter().map(ContourTopology::of).collect(),
            curve_count: 0,
        };
        topology.recount();
        topology
    }

    /// Freezes one cubic subdivision count large enough for every compatible
    /// contour set.
    pub(crate) fn from_compatible_contours<'a>(
        reference: &[ResolvedContour],
        compatible: impl IntoIterator<Item = &'a [ResolvedContour]>,
    ) -> Result<Self, AuthoredSlugError> {
        let mut topology = Self::from_contours(reference);
        for contours in compatible {
            topology.include_cubic_subdivisions(contours)?;
        }
        Ok(topology)
    }

    /// Returns the shape of each output quadratic, in curve order.
    pub(crate) fn curve_shapes(&self) -> impl Iterator<Item = CurveShape> + '_ {
        self.contours
            .iter()
            .flat_map(|contour| &contour.segments)
            .flat_map(|segment| segment.curve_shapes())
    }

    /// Pairs curves evaluated from this topology with its curve shapes.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::CurveShapeCountMismatch`] when `curves` was not
    /// evaluated from this topology.
    pub(crate) fn outline_of(&self, curves: Vec<Curve>) -> Result<QuadraticOutline, SlugError> {
        QuadraticOutline::new(curves, self.curve_shapes().collect())
    }

    /// Evaluates this topology against topology-compatible contours, with curve shapes.
    ///
    /// # Errors
    ///
    /// Returns the errors of [`Self::curves_from_contours`].
    pub(crate) fn outline_from_contours<C: ContourPoints>(
        &self,
        contours: &[C],
    ) -> Result<QuadraticOutline, AuthoredSlugError> {
        Ok(self.outline_of(self.curves_from_contours(contours)?)?)
    }

    /// Evaluates this topology against topology-compatible contours.
    pub(crate) fn curves_from_contours<C: ContourPoints>(
        &self,
        contours: &[C],
    ) -> Result<Vec<Curve>, AuthoredSlugError> {
        self.ensure_contour_count(contours.len())?;
        let mut curves = Vec::with_capacity(self.curve_count);
        for (contour_index, (topology, contour)) in self.contours.iter().zip(contours).enumerate() {
            if !topology.matches(contour) {
                return Err(AuthoredSlugError::ContourTopologyMismatch { contour_index });
            }
            let points = contour.slug_points(contour_index)?;
            for segment in &topology.segments {
                segment.append_curves(&mut curves, &points);
            }
        }
        debug_assert_eq!(curves.len(), self.curve_count);
        Ok(curves)
    }

    fn include_cubic_subdivisions<C: ContourPoints>(
        &mut self,
        contours: &[C],
    ) -> Result<(), AuthoredSlugError> {
        self.ensure_contour_count(contours.len())?;
        for (contour_index, (topology, contour)) in
            self.contours.iter_mut().zip(contours).enumerate()
        {
            let points = contour.slug_points(contour_index)?;
            for segment in &mut topology.segments {
                segment
                    .widen_subdivisions(&points)
                    .ok_or(AuthoredSlugError::ContourTopologyMismatch { contour_index })?;
            }
        }
        self.recount();
        Ok(())
    }

    fn ensure_contour_count(&self, actual: usize) -> Result<(), AuthoredSlugError> {
        if actual == self.contours.len() {
            return Ok(());
        }
        Err(AuthoredSlugError::ContourCountMismatch {
            expected: self.contours.len(),
            actual,
        })
    }

    fn recount(&mut self) {
        self.curve_count = self
            .contours
            .iter()
            .flat_map(|contour| &contour.segments)
            .map(|segment| segment.curve_count())
            .sum();
    }
}

impl AuthoredCurveTopology {
    /// Captures contour order, point kinds, and segment-to-point correspondence.
    pub fn from_layer(layer: &GlyphLayer) -> Self {
        Self {
            curves: CurveTopology::from_contours(layer.contours_iter()),
            identities: layer.contours_iter().map(ContourIdentity::of).collect(),
        }
    }

    /// Freezes one cubic subdivision count large enough for every compatible layer.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredSlugError::ContourCountMismatch`] or
    /// [`AuthoredSlugError::ContourTopologyMismatch`] when a layer's contours do not match the
    /// reference's, and [`AuthoredSlugError::Slug`] when a subdivision count overflows.
    pub fn from_compatible_layers<'a>(
        reference_layer: &GlyphLayer,
        compatible_layers: impl IntoIterator<Item = &'a GlyphLayer>,
    ) -> Result<Self, AuthoredSlugError> {
        let mut topology = Self::from_layer(reference_layer);
        for layer in compatible_layers {
            let contours = topology.matching_contours(layer)?;
            topology.curves.include_cubic_subdivisions(&contours)?;
        }
        Ok(topology)
    }

    pub fn curve_count(&self) -> usize {
        self.curves.curve_count
    }

    /// Returns the shape of each output quadratic, in curve order.
    pub fn curve_shapes(&self) -> impl Iterator<Item = CurveShape> + '_ {
        self.curves.curve_shapes()
    }

    /// Pairs curves evaluated from this topology with its curve shapes.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::CurveShapeCountMismatch`] when `curves` was not
    /// evaluated from this topology.
    pub fn outline_of(&self, curves: Vec<Curve>) -> Result<QuadraticOutline, SlugError> {
        self.curves.outline_of(curves)
    }

    /// Evaluates this exact topology against a topology-compatible layer.
    ///
    /// # Errors
    ///
    /// Returns [`AuthoredSlugError::ContourCountMismatch`] or
    /// [`AuthoredSlugError::ContourTopologyMismatch`] when the layer does not match this topology,
    /// and [`AuthoredSlugError::NonFiniteCoordinate`] when a point is not finite.
    pub fn curves_from_layer(&self, layer: &GlyphLayer) -> Result<Vec<Curve>, AuthoredSlugError> {
        let contours = self.matching_contours(layer)?;
        self.curves.curves_from_contours(&contours)
    }

    /// Returns `layer`'s contours when each keeps this topology's ids,
    /// closure, and point kinds.
    fn matching_contours<'a>(
        &self,
        layer: &'a GlyphLayer,
    ) -> Result<Vec<&'a Contour>, AuthoredSlugError> {
        let contours = layer.contours_iter().collect::<Vec<_>>();
        self.curves.ensure_contour_count(contours.len())?;
        for (contour_index, ((identity, topology), contour)) in self
            .identities
            .iter()
            .zip(&self.curves.contours)
            .zip(&contours)
            .enumerate()
        {
            if !identity.matches(contour) || !topology.matches(*contour) {
                return Err(AuthoredSlugError::ContourTopologyMismatch { contour_index });
            }
        }
        Ok(contours)
    }
}

/// Adds a variable glyph whose sources are already-resolved, compatible
/// contour sets, each weighted by its weight index.
///
/// # Errors
///
/// Returns an error when `sources` is empty or the contour sets don't share
/// one structure.
pub(crate) fn add_resolved_sources_glyph(
    builder: &mut VariableAtlasBuilder,
    sources: &[(u32, &[ResolvedContour])],
) -> Result<GlyphIndex, AuthoredSlugError> {
    let ((base_weight_index, base), rest) = sources
        .split_first()
        .ok_or(AuthoredSlugError::MissingInterpolationSources)?;
    let topology =
        CurveTopology::from_compatible_contours(base, rest.iter().map(|(_, contours)| *contours))?;
    let base_outline = topology.outline_from_contours(base)?;
    let source_curves = rest
        .iter()
        .map(|(weight_index, contours)| {
            Ok((*weight_index, topology.curves_from_contours(contours)?))
        })
        .collect::<Result<Vec<_>, AuthoredSlugError>>()?;
    builder
        .add_outline_glyph(base_outline, *base_weight_index, source_curves)
        .map_err(Into::into)
}

/// Converts one already-resolved contour set for CPU-oracle comparison.
///
/// # Errors
///
/// Returns [`AuthoredSlugError::NonFiniteCoordinate`] when a point is not finite.
pub fn curves_from_resolved_contours(
    contours: &[ResolvedContour],
) -> Result<Vec<Curve>, AuthoredSlugError> {
    let topology = CurveTopology::from_contours(contours);
    topology.curves_from_contours(contours)
}

/// Returns unsupported authored semantics before atlas construction mutates state.
pub fn authored_glyph_requirements(projection: &GlyphProjection) -> AuthoredGlyphRequirements {
    let default_components = projection.components().components();
    let exact_components = projection
        .exact_source_components()
        .iter()
        .map(|variant| variant.components().components().len())
        .sum::<usize>();
    let direct_fallback_components = projection.fallback().components().len();

    AuthoredGlyphRequirements {
        component_occurrences: default_components
            .len()
            .max(direct_fallback_components)
            .saturating_add(exact_components),
        exact_source_shapes: projection.exact_source_shapes().len(),
        exact_component_variants: projection.exact_source_components().len(),
    }
}

/// Adds one projection without ever comparing independently resolved pen streams.
///
/// `source_weight_indices` must follow `interpolation.basis().source_ids()`.
/// Static glyphs use `constant_weight_index`, whose uploaded value must be one.
///
/// # Errors
///
/// Returns [`AuthoredSlugError::UnsupportedGlyph`] when the projection has components or
/// exact-source shapes, a topology or finiteness error when a source does not match the default,
/// and [`AuthoredSlugError::Slug`] when the atlas outgrows its limits.
pub fn add_authored_projection_glyph(
    builder: &mut VariableAtlasBuilder,
    projection: &GlyphProjection,
    source_weight_indices: &[u32],
    constant_weight_index: u32,
) -> Result<GlyphIndex, AuthoredSlugError> {
    let requirements = authored_glyph_requirements(projection);
    if !requirements.is_supported() {
        return Err(AuthoredSlugError::UnsupportedGlyph(requirements));
    }
    add_default_projection_glyph(
        builder,
        &mut AuthoredDefaultGlyphs::new(),
        &mut Vec::new(),
        projection,
        source_weight_indices,
        constant_weight_index,
    )
}

fn add_default_projection_glyph(
    builder: &mut VariableAtlasBuilder,
    defaults: &mut AuthoredDefaultGlyphs,
    inserted_defaults: &mut Vec<AuthoredDefaultKey>,
    projection: &GlyphProjection,
    source_weight_indices: &[u32],
    constant_weight_index: u32,
) -> Result<GlyphIndex, AuthoredSlugError> {
    let key = (
        projection.glyph_id(),
        source_weight_indices.to_vec(),
        constant_weight_index,
    );
    if let Some(glyph_index) = defaults.get(&key) {
        let glyph_index = *glyph_index;
        return Ok(glyph_index);
    }

    let Some(interpolation) = projection.interpolation() else {
        if !source_weight_indices.is_empty() {
            return Err(AuthoredSlugError::WeightCountMismatch {
                expected: 0,
                actual: source_weight_indices.len(),
            });
        }
        let topology = AuthoredCurveTopology::from_layer(projection.fallback());
        let outline = topology.outline_of(topology.curves_from_layer(projection.fallback())?)?;
        let advance = authored_advance(projection.fallback().width(), 0)?;
        let glyph_index = builder.add_outline_glyph(outline, constant_weight_index, [])?;
        builder.set_glyph_source_advances(glyph_index, [advance])?;
        defaults.insert(key.clone(), glyph_index);
        inserted_defaults.push(key);
        return Ok(glyph_index);
    };

    let sources = interpolation.sources();
    if sources.is_empty() {
        return Err(AuthoredSlugError::MissingInterpolationSources);
    }
    if source_weight_indices.len() != sources.len() {
        return Err(AuthoredSlugError::WeightCountMismatch {
            expected: sources.len(),
            actual: source_weight_indices.len(),
        });
    }

    let mut source_layers = Vec::with_capacity(sources.len());
    let mut source_advances = Vec::with_capacity(sources.len());
    for (source_index, (source, weight_index)) in
        sources.iter().zip(source_weight_indices).enumerate()
    {
        let mut layer = interpolation.reference_layer().clone();
        layer.apply_interpolation_values(source.values())?;
        source_advances.push(authored_advance(layer.width(), source_index)?);
        source_layers.push((*weight_index, layer));
    }

    let topology = AuthoredCurveTopology::from_compatible_layers(
        interpolation.reference_layer(),
        source_layers.iter().map(|(_, layer)| layer),
    )?;
    let source_curves = source_layers
        .iter()
        .map(|(weight_index, layer)| Ok((*weight_index, topology.curves_from_layer(layer)?)))
        .collect::<Result<Vec<_>, AuthoredSlugError>>()?;

    let (base_weight_index, base_curves) = source_curves
        .first()
        .cloned()
        .ok_or(AuthoredSlugError::MissingInterpolationSources)?;
    let glyph_index = builder.add_outline_glyph(
        topology.outline_of(base_curves)?,
        base_weight_index,
        source_curves.into_iter().skip(1),
    )?;
    builder.set_glyph_source_advances(glyph_index, source_advances)?;
    defaults.insert(key.clone(), glyph_index);
    inserted_defaults.push(key);
    Ok(glyph_index)
}

/// Adds a component glyph through the general resident component evaluator.
///
/// This compatibility API supplies the root basis for every component glyph.
/// Use [`add_authored_glyph_with_weight_sets`] when component glyphs have
/// independently deduplicated interpolation bases or exact-source variants.
///
/// # Errors
///
/// Returns [`AuthoredSlugError::UnsupportedGlyph`] when the projection has exact-source shapes or
/// component variants, [`AuthoredSlugError::MissingInterpolationSources`] when a component glyph
/// has no interpolation, [`AuthoredSlugError::WeightCountMismatch`] when `source_weight_indices`
/// does not match the basis, and the errors of [`add_authored_glyph_with_weight_sets`].
pub fn add_authored_component_projection_glyph(
    builder: &mut VariableAtlasBuilder,
    font: &Font,
    projection: &GlyphProjection,
    source_weight_indices: &[u32],
) -> Result<GlyphIndex, AuthoredSlugError> {
    let requirements = authored_glyph_requirements(projection);
    if requirements.component_occurrences == 0 {
        return add_authored_projection_glyph(builder, projection, source_weight_indices, 0);
    }
    if requirements.exact_source_shapes != 0 || requirements.exact_component_variants != 0 {
        return Err(AuthoredSlugError::UnsupportedGlyph(requirements));
    }
    let interpolation = projection
        .interpolation()
        .ok_or(AuthoredSlugError::MissingInterpolationSources)?;
    let weight_set = AuthoredWeightSet::new(
        interpolation.basis().clone(),
        source_weight_indices.to_vec(),
    )?;
    let glyph_id = projection.glyph_id();
    let projection_set = font.glyph_projection_set(std::slice::from_ref(&glyph_id))?;
    let projection = projection_set.projection(glyph_id).require(&glyph_id)?;
    let checkpoint = builder.checkpoint();
    let weight_sets = [weight_set];
    let mut profile = AuthoredAtlasProfile::default();
    let mut compilation = AuthoredGlyphCompilation {
        font,
        projection_set: &projection_set,
        weight_sets: &weight_sets,
        constant_weight_index: 0,
        profile: &mut profile,
    };
    let glyph_index = component::add_default_component_projection_glyph(
        builder,
        &mut AuthoredDefaultGlyphs::new(),
        &mut Vec::new(),
        &mut compilation,
        projection,
        &mut HashMap::new(),
    )
    .map_err(|error| match error {
        AuthoredSlugError::MissingWeightBasis(_) => AuthoredSlugError::ComponentBasisMismatch,
        error => error,
    })
    .inspect_err(|_| builder.rollback(checkpoint))?;
    Ok(glyph_index)
}

/// Adds the compatible default plus resident exact-source topology variants.
///
/// This compatibility API uses the root basis for the complete component
/// closure. Use [`add_authored_glyph_with_weight_sets`] for differing bases.
///
/// # Errors
///
/// Returns [`AuthoredSlugError::WeightCountMismatch`] when `source_weight_indices` does not match
/// the projection's basis, and the errors of [`add_authored_glyph_with_weight_sets`].
pub fn add_authored_glyph(
    builder: &mut VariableAtlasBuilder,
    font: &Font,
    projection: &GlyphProjection,
    source_weight_indices: &[u32],
    constant_weight_index: u32,
) -> Result<AuthoredGlyph, AuthoredSlugError> {
    let weight_sets = projection
        .interpolation()
        .map(|interpolation| {
            AuthoredWeightSet::new(
                interpolation.basis().clone(),
                source_weight_indices.to_vec(),
            )
        })
        .transpose()?
        .into_iter()
        .collect::<Vec<_>>();
    add_authored_glyph_with_weight_sets(
        builder,
        font,
        projection,
        &weight_sets,
        constant_weight_index,
    )
    .map_err(|error| match error {
        AuthoredSlugError::MissingWeightBasis(_) => AuthoredSlugError::ComponentBasisMismatch,
        error => error,
    })
}

fn source_location(
    font: &Font,
    source_id: SourceId,
) -> Result<&shift_font::DesignLocation, AuthoredSlugError> {
    font.source(source_id)
        .map(shift_font::Source::location)
        .ok_or(AuthoredSlugError::MissingSourceLocation(source_id))
}

fn authored_advance(value: f64, source_index: usize) -> Result<f32, AuthoredSlugError> {
    let advance = lossy_f32(value);
    if value.is_finite() && advance.is_finite() {
        Ok(advance)
    } else {
        Err(AuthoredSlugError::NonFiniteAdvance { source_index })
    }
}

fn slug_point_unchecked(point: &FontPoint) -> Point {
    Point::new(lossy_f32(point.x()), lossy_f32(point.y()))
}

fn slug_point(
    point: &FontPoint,
    contour_index: usize,
    point_index: usize,
) -> Result<Point, AuthoredSlugError> {
    let x = lossy_f32(point.x());
    let y = lossy_f32(point.y());
    if point.x().is_finite() && point.y().is_finite() && x.is_finite() && y.is_finite() {
        Ok(Point::new(x, y))
    } else {
        Err(AuthoredSlugError::NonFiniteCoordinate {
            contour_index,
            point_index,
        })
    }
}
