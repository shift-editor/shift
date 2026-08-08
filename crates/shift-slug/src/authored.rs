//! Stable `shift-font` point/segment topologies for resident Slug geometry.
//!
//! Production variation must not pair independently resolved outline callbacks:
//! command kinds can change when geometry becomes degenerate. This module builds
//! one topology from the interpolation reference layer, then evaluates every
//! compatible source through the same contour, point, and segment indexes.

use std::{collections::HashMap, error::Error, fmt};

use shift_font::{
    composite::ResolvedContour, ContourId, CoreError, CurveSegment, CurveSegmentIter, Font,
    GlyphLayer, GlyphProjection, GlyphProjectionSet, Point as FontPoint, PointId, PointType,
    SourceId,
};

use crate::{AuthoredAtlasProfile, Curve, Point, SlugError, VariableAtlasBuilder};

mod component;
pub use component::{add_authored_glyph_with_weight_sets, AuthoredWeightSet};

pub(crate) type AuthoredDefaultKey = (shift_font::GlyphId, Vec<u32>, u32);
pub(crate) type AuthoredDefaultGlyphs = HashMap<AuthoredDefaultKey, u32>;

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
    pub attachment_count: usize,
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
    pub default_glyph: u32,
    pub exact_sources: Vec<AuthoredSourceGlyph>,
}

impl AuthoredGlyph {
    /// Selects an exact-source topology or the compatible default glyph.
    pub fn glyph_for_source(&self, source_id: Option<&SourceId>) -> u32 {
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
    pub glyph_index: u32,
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
    pub fn new(band_count: u32) -> Result<Self, SlugError> {
        Ok(Self {
            builder: VariableAtlasBuilder::new(band_count)?,
            defaults: HashMap::new(),
        })
    }

    /// Adds an identity-preserving blank for an authored glyph without layers.
    pub fn add_empty_glyph(
        &mut self,
        constant_weight_index: u32,
    ) -> Result<AuthoredGlyph, AuthoredSlugError> {
        let default_glyph = self.builder.add_curve_glyph_with_sources_and_lines(
            std::iter::empty(),
            std::iter::empty(),
            constant_weight_index,
            std::iter::empty(),
        )?;
        Ok(AuthoredGlyph {
            default_glyph,
            exact_sources: Vec::new(),
        })
    }

    pub fn add_glyph(
        &mut self,
        font: &Font,
        projection: &GlyphProjection,
        weight_sets: &[AuthoredWeightSet],
        constant_weight_index: u32,
    ) -> Result<AuthoredGlyph, AuthoredSlugError> {
        let glyph_id = projection.glyph_id();
        let projection_set = font.glyph_projection_set(std::slice::from_ref(&glyph_id))?;
        let projection = projection_set
            .projection(&glyph_id)
            .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
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
                "authored Slug adapter does not yet support {} component occurrences, {} attachments, {} exact-source shapes, and {} exact component variants",
                requirements.component_occurrences,
                requirements.attachment_count,
                requirements.exact_source_shapes,
                requirements.exact_component_variants,
            ),
            Self::MissingInterpolationSources => {
                formatter.write_str("authored glyph interpolation has no compatible sources")
            }
            Self::MissingSourceLocation(source_id) => {
                write!(formatter, "authored source {source_id} has no font location")
            }
            Self::ComponentBasisMismatch => formatter.write_str(
                "component interpolation basis differs from the root glyph basis",
            ),
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
    contours: Vec<ContourTopology>,
    curve_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ContourTopology {
    contour_id: ContourId,
    closed: bool,
    point_ids: Vec<PointId>,
    point_types: Vec<PointType>,
    segments: Vec<SegmentTopology>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ResolvedContourTopology {
    closed: bool,
    point_types: Vec<PointType>,
    segments: Vec<SegmentTopology>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ResolvedCurveTopology {
    contours: Vec<ResolvedContourTopology>,
    curve_count: usize,
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

impl SegmentTopology {
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
}

impl AuthoredCurveTopology {
    /// Captures contour order, point kinds, and segment-to-point correspondence.
    pub fn from_layer(layer: &GlyphLayer) -> Self {
        let contours = layer
            .contours_iter()
            .map(|contour| {
                let points = contour.points();
                let mut segments = CurveSegmentIter::new(points, contour.is_closed())
                    .map(|segment| segment_topology(points, segment))
                    .collect::<Vec<_>>();

                if let (Some(first), Some(last)) =
                    (segments.first().copied(), segments.last().copied())
                {
                    let start = segment_start(first);
                    let end = last.end();
                    if start != end {
                        segments.push(SegmentTopology::Line([end, start]));
                    }
                }

                ContourTopology {
                    contour_id: contour.id(),
                    closed: contour.is_closed(),
                    point_ids: points.iter().map(FontPoint::id).collect(),
                    point_types: points.iter().map(FontPoint::point_type).collect(),
                    segments,
                }
            })
            .collect::<Vec<_>>();
        let curve_count = contours
            .iter()
            .flat_map(|contour| &contour.segments)
            .map(|segment| segment.curve_count())
            .sum();

        Self {
            contours,
            curve_count,
        }
    }

    /// Freezes one cubic subdivision count large enough for every compatible layer.
    pub fn from_compatible_layers<'a>(
        reference_layer: &GlyphLayer,
        compatible_layers: impl IntoIterator<Item = &'a GlyphLayer>,
    ) -> Result<Self, AuthoredSlugError> {
        let mut topology = Self::from_layer(reference_layer);
        for layer in compatible_layers {
            topology.include_layer_cubic_subdivisions(layer)?;
        }
        Ok(topology)
    }

    fn include_layer_cubic_subdivisions(
        &mut self,
        layer: &GlyphLayer,
    ) -> Result<(), AuthoredSlugError> {
        let contours = layer.contours_iter().collect::<Vec<_>>();
        if contours.len() != self.contours.len() {
            return Err(AuthoredSlugError::ContourCountMismatch {
                expected: self.contours.len(),
                actual: contours.len(),
            });
        }

        for (contour_index, (topology, contour)) in
            self.contours.iter_mut().zip(contours).enumerate()
        {
            let point_ids = contour
                .points()
                .iter()
                .map(FontPoint::id)
                .collect::<Vec<_>>();
            let point_types = contour
                .points()
                .iter()
                .map(FontPoint::point_type)
                .collect::<Vec<_>>();
            if contour.id() != topology.contour_id
                || contour.is_closed() != topology.closed
                || point_ids != topology.point_ids
                || point_types != topology.point_types
            {
                return Err(AuthoredSlugError::ContourTopologyMismatch { contour_index });
            }

            let points = contour
                .points()
                .iter()
                .enumerate()
                .map(|(point_index, point)| slug_point(point, contour_index, point_index))
                .collect::<Result<Vec<_>, _>>()?;
            for segment in &mut topology.segments {
                let SegmentTopology::Cubic {
                    points: [p0, p1, p2, p3],
                    subdivision_count,
                } = segment
                else {
                    continue;
                };
                *subdivision_count = (*subdivision_count).max(Curve::cubic_subdivision_count(
                    points[*p0],
                    points[*p1],
                    points[*p2],
                    points[*p3],
                ));
            }
        }
        self.curve_count = self
            .contours
            .iter()
            .flat_map(|contour| &contour.segments)
            .map(|segment| segment.curve_count())
            .sum();
        Ok(())
    }

    pub fn curve_count(&self) -> usize {
        self.curve_count
    }

    /// Returns one flag per output quadratic whose control is derived from a line.
    pub fn line_flags(&self) -> Vec<bool> {
        line_flags(self.contours.iter().flat_map(|contour| &contour.segments))
    }

    /// Evaluates this exact topology against a topology-compatible layer.
    pub fn curves_from_layer(&self, layer: &GlyphLayer) -> Result<Vec<Curve>, AuthoredSlugError> {
        let contours = layer.contours_iter().collect::<Vec<_>>();
        if contours.len() != self.contours.len() {
            return Err(AuthoredSlugError::ContourCountMismatch {
                expected: self.contours.len(),
                actual: contours.len(),
            });
        }

        let mut curves = Vec::with_capacity(self.curve_count);
        for (contour_index, (topology, contour)) in self.contours.iter().zip(contours).enumerate() {
            let point_ids = contour
                .points()
                .iter()
                .map(FontPoint::id)
                .collect::<Vec<_>>();
            let point_types = contour
                .points()
                .iter()
                .map(FontPoint::point_type)
                .collect::<Vec<_>>();
            if contour.id() != topology.contour_id
                || contour.is_closed() != topology.closed
                || point_ids != topology.point_ids
                || point_types != topology.point_types
            {
                return Err(AuthoredSlugError::ContourTopologyMismatch { contour_index });
            }

            let points = contour
                .points()
                .iter()
                .enumerate()
                .map(|(point_index, point)| slug_point(point, contour_index, point_index))
                .collect::<Result<Vec<_>, _>>()?;
            for segment in &topology.segments {
                append_segment(&mut curves, *segment, &points);
            }
        }
        debug_assert_eq!(curves.len(), self.curve_count);
        Ok(curves)
    }
}

impl ResolvedCurveTopology {
    fn from_contours(contours: &[ResolvedContour]) -> Self {
        let contours = contours
            .iter()
            .map(|contour| {
                let points = &contour.points;
                let mut segments = CurveSegmentIter::new(points, contour.closed)
                    .map(|segment| segment_topology(points, segment))
                    .collect::<Vec<_>>();
                if let (Some(first), Some(last)) =
                    (segments.first().copied(), segments.last().copied())
                {
                    let start = segment_start(first);
                    let end = last.end();
                    if start != end {
                        segments.push(SegmentTopology::Line([end, start]));
                    }
                }
                ResolvedContourTopology {
                    closed: contour.closed,
                    point_types: points.iter().map(FontPoint::point_type).collect(),
                    segments,
                }
            })
            .collect::<Vec<_>>();
        let curve_count = contours
            .iter()
            .flat_map(|contour| &contour.segments)
            .map(|segment| segment.curve_count())
            .sum();
        Self {
            contours,
            curve_count,
        }
    }

    fn line_flags(&self) -> Vec<bool> {
        line_flags(self.contours.iter().flat_map(|contour| &contour.segments))
    }

    fn curves_from_contours(
        &self,
        contours: &[ResolvedContour],
    ) -> Result<Vec<Curve>, AuthoredSlugError> {
        if contours.len() != self.contours.len() {
            return Err(AuthoredSlugError::ContourCountMismatch {
                expected: self.contours.len(),
                actual: contours.len(),
            });
        }
        let mut curves = Vec::with_capacity(self.curve_count);
        for (contour_index, (topology, contour)) in self.contours.iter().zip(contours).enumerate() {
            let point_types = contour
                .points
                .iter()
                .map(FontPoint::point_type)
                .collect::<Vec<_>>();
            if contour.closed != topology.closed || point_types != topology.point_types {
                return Err(AuthoredSlugError::ContourTopologyMismatch { contour_index });
            }
            let points = contour
                .points
                .iter()
                .enumerate()
                .map(|(point_index, point)| slug_point(point, contour_index, point_index))
                .collect::<Result<Vec<_>, _>>()?;
            for segment in &topology.segments {
                append_segment(&mut curves, *segment, &points);
            }
        }
        debug_assert_eq!(curves.len(), self.curve_count);
        Ok(curves)
    }
}

/// Converts one already-resolved contour set for CPU-oracle comparison.
pub fn curves_from_resolved_contours(
    contours: &[ResolvedContour],
) -> Result<Vec<Curve>, AuthoredSlugError> {
    let topology = ResolvedCurveTopology::from_contours(contours);
    topology.curves_from_contours(contours)
}

/// Returns unsupported authored semantics before atlas construction mutates state.
pub fn authored_glyph_requirements(projection: &GlyphProjection) -> AuthoredGlyphRequirements {
    let default_components = projection.components().components();
    let exact_components = projection
        .exact_source_components()
        .iter()
        .flat_map(|variant| variant.components().components())
        .collect::<Vec<_>>();
    let direct_fallback_components = projection.fallback().components().len();

    AuthoredGlyphRequirements {
        component_occurrences: default_components
            .len()
            .max(direct_fallback_components)
            .saturating_add(exact_components.len()),
        attachment_count: default_components
            .iter()
            .chain(exact_components)
            .filter(|component| component.attachment().is_some())
            .count(),
        exact_source_shapes: projection.exact_source_shapes().len(),
        exact_component_variants: projection.exact_source_components().len(),
    }
}

/// Adds one projection without ever comparing independently resolved pen streams.
///
/// `source_weight_indices` must follow `interpolation.basis().source_ids()`.
/// Static glyphs use `constant_weight_index`, whose uploaded value must be one.
pub fn add_authored_projection_glyph(
    builder: &mut VariableAtlasBuilder,
    projection: &GlyphProjection,
    source_weight_indices: &[u32],
    constant_weight_index: u32,
) -> Result<u32, AuthoredSlugError> {
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
) -> Result<u32, AuthoredSlugError> {
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
        let curves = topology.curves_from_layer(projection.fallback())?;
        let advance = authored_advance(projection.fallback().width(), 0)?;
        let glyph_index = builder.add_curve_glyph_with_sources_and_lines(
            curves,
            topology.line_flags(),
            constant_weight_index,
            [],
        )?;
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
    let glyph_index = builder.add_curve_glyph_with_sources_and_lines(
        base_curves,
        topology.line_flags(),
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
pub fn add_authored_component_projection_glyph(
    builder: &mut VariableAtlasBuilder,
    font: &Font,
    projection: &GlyphProjection,
    source_weight_indices: &[u32],
) -> Result<u32, AuthoredSlugError> {
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
    let projection = projection_set
        .projection(&glyph_id)
        .ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?;
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

fn source_location<'a>(
    font: &'a Font,
    source_id: &SourceId,
) -> Result<&'a shift_font::DesignLocation, AuthoredSlugError> {
    font.sources()
        .iter()
        .find(|source| source.id() == *source_id)
        .map(shift_font::Source::location)
        .ok_or_else(|| AuthoredSlugError::MissingSourceLocation(source_id.clone()))
}

fn line_flags<'a>(segments: impl IntoIterator<Item = &'a SegmentTopology>) -> Vec<bool> {
    segments
        .into_iter()
        .flat_map(|segment| {
            let (is_line, count) = match segment {
                SegmentTopology::Line(_) => (true, 1),
                SegmentTopology::Quad(_) => (false, 1),
                SegmentTopology::Cubic {
                    subdivision_count, ..
                } => (false, *subdivision_count),
            };
            std::iter::repeat_n(is_line, count)
        })
        .collect()
}

fn segment_topology(points: &[FontPoint], segment: CurveSegment<'_>) -> SegmentTopology {
    match segment {
        CurveSegment::Line(p0, p1) => {
            SegmentTopology::Line([point_index(points, p0), point_index(points, p1)])
        }
        CurveSegment::Quad(p0, p1, p2) => SegmentTopology::Quad([
            point_index(points, p0),
            point_index(points, p1),
            point_index(points, p2),
        ]),
        CurveSegment::Cubic(p0, p1, p2, p3) => {
            let points = [
                point_index(points, p0),
                point_index(points, p1),
                point_index(points, p2),
                point_index(points, p3),
            ];
            SegmentTopology::Cubic {
                subdivision_count: Curve::cubic_subdivision_count(
                    slug_point_unchecked(p0),
                    slug_point_unchecked(p1),
                    slug_point_unchecked(p2),
                    slug_point_unchecked(p3),
                ),
                points,
            }
        }
    }
}

fn point_index(points: &[FontPoint], target: &FontPoint) -> usize {
    points
        .iter()
        .position(|point| std::ptr::eq(point, target))
        .expect("curve segment points borrow their source contour")
}

fn segment_start(segment: SegmentTopology) -> usize {
    match segment {
        SegmentTopology::Line(points) => points[0],
        SegmentTopology::Quad(points) => points[0],
        SegmentTopology::Cubic { points, .. } => points[0],
    }
}

fn authored_advance(value: f64, source_index: usize) -> Result<f32, AuthoredSlugError> {
    let advance = value as f32;
    if value.is_finite() && advance.is_finite() {
        Ok(advance)
    } else {
        Err(AuthoredSlugError::NonFiniteAdvance { source_index })
    }
}

fn slug_point_unchecked(point: &FontPoint) -> Point {
    Point::new(point.x() as f32, point.y() as f32)
}

fn slug_point(
    point: &FontPoint,
    contour_index: usize,
    point_index: usize,
) -> Result<Point, AuthoredSlugError> {
    let x = point.x() as f32;
    let y = point.y() as f32;
    if point.x().is_finite() && point.y().is_finite() && x.is_finite() && y.is_finite() {
        Ok(Point::new(x, y))
    } else {
        Err(AuthoredSlugError::NonFiniteCoordinate {
            contour_index,
            point_index,
        })
    }
}

fn append_segment(curves: &mut Vec<Curve>, segment: SegmentTopology, points: &[Point]) {
    match segment {
        SegmentTopology::Line([p0, p1]) => {
            curves.push(Curve::from_line(points[p0], points[p1]));
        }
        SegmentTopology::Quad([p0, p1, p2]) => curves.push(Curve {
            p0: points[p0],
            p1: points[p1],
            p2: points[p2],
        }),
        SegmentTopology::Cubic {
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
