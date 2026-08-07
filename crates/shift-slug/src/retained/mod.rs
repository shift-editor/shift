use crate::{Curve, Point, SlugError, SlugPreviewExtents, VariableAtlas, VariableAtlasBuilder};

mod weights;

pub use weights::{AtlasAxis, AtlasRegion, ComplementRegistry, RegionAxis, RegionRegistry};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GlyphSegment {
    Line,
    Quadratic,
    Cubic,
}

impl GlyphSegment {
    fn point_count(self) -> usize {
        match self {
            Self::Line => 2,
            Self::Quadratic => 3,
            Self::Cubic => 4,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlyphShape {
    segments: Box<[GlyphSegment]>,
}

impl GlyphShape {
    pub fn new(segments: Vec<GlyphSegment>) -> Self {
        Self {
            segments: segments.into_boxed_slice(),
        }
    }

    pub fn segments(&self) -> &[GlyphSegment] {
        &self.segments
    }

    fn value_count(&self) -> Result<usize, SlugError> {
        self.segments.iter().try_fold(1_usize, |count, segment| {
            count
                .checked_add(segment.point_count() * 2)
                .ok_or(SlugError::LengthOverflow)
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExactVariant {
    pub source_index: u32,
    pub shape: GlyphShape,
    pub values: Box<[f64]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphInput {
    pub shape: GlyphShape,
    pub base_values: Box<[f64]>,
    pub samples: Vec<(u32, Box<[f64]>)>,
    pub exact_variants: Vec<ExactVariant>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PageInput {
    pub glyphs: Vec<(u32, GlyphInput)>,
    pub axes: Vec<AtlasAxis>,
    pub regions: Vec<AtlasRegion>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RetainedAtlasPage {
    atlas: VariableAtlas,
    descriptor: RetainedAtlasDescriptor,
}

impl RetainedAtlasPage {
    pub fn from_parts(
        atlas: VariableAtlas,
        glyphs: Vec<(u32, u32)>,
        exact_glyphs: Vec<(u32, u32, u32)>,
        axes: Vec<AtlasAxis>,
        regions: Vec<AtlasRegion>,
        complements: Vec<Box<[u32]>>,
    ) -> Self {
        Self {
            atlas,
            descriptor: RetainedAtlasDescriptor {
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

    pub fn glyphs(&self) -> &[(u32, u32)] {
        self.descriptor.glyphs()
    }

    pub fn exact_glyphs(&self) -> &[(u32, u32, u32)] {
        self.descriptor.exact_glyphs()
    }

    pub fn weights(&self, location: &[f64]) -> Result<Vec<f32>, SlugError> {
        self.descriptor.weights(location)
    }

    pub fn preview_extents(&self) -> Result<SlugPreviewExtents, SlugError> {
        self.descriptor.preview_extents(&self.atlas)
    }

    pub fn into_parts(self) -> (VariableAtlas, RetainedAtlasDescriptor) {
        (self.atlas, self.descriptor)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RetainedAtlasDescriptor {
    glyphs: Box<[(u32, u32)]>,
    exact_glyphs: Box<[(u32, u32, u32)]>,
    axes: Box<[AtlasAxis]>,
    regions: Box<[AtlasRegion]>,
    complements: Box<[Box<[u32]>]>,
}

impl RetainedAtlasDescriptor {
    pub fn glyphs(&self) -> &[(u32, u32)] {
        &self.glyphs
    }

    pub fn exact_glyphs(&self) -> &[(u32, u32, u32)] {
        &self.exact_glyphs
    }

    pub fn preview_extents(&self, atlas: &VariableAtlas) -> Result<SlugPreviewExtents, SlugError> {
        let glyphs = self
            .glyphs
            .iter()
            .map(|(_, glyph)| *glyph)
            .chain(self.exact_glyphs.iter().map(|(_, _, glyph)| *glyph))
            .collect::<Vec<_>>();
        atlas.preview_extents(&glyphs)
    }

    pub fn weights(&self, location: &[f64]) -> Result<Vec<f32>, SlugError> {
        weights::weights(&self.axes, &self.regions, &self.complements, location)
    }
}

pub struct PageCompiler {
    builder: VariableAtlasBuilder,
    glyphs: Vec<(u32, u32)>,
    exact_glyphs: Vec<(u32, u32, u32)>,
    axes: Vec<AtlasAxis>,
    regions: Vec<AtlasRegion>,
    complements: ComplementRegistry,
}

impl PageCompiler {
    pub fn new(
        band_count: u32,
        axes: Vec<AtlasAxis>,
        regions: Vec<AtlasRegion>,
    ) -> Result<Self, SlugError> {
        Ok(Self {
            builder: VariableAtlasBuilder::new(band_count)?,
            glyphs: Vec::new(),
            exact_glyphs: Vec::new(),
            axes,
            complements: ComplementRegistry::new(regions.len())?,
            regions,
        })
    }

    pub fn add_glyph(
        &mut self,
        root: u32,
        base_curves: Vec<Curve>,
        line_flags: Vec<bool>,
        base_advance: f32,
        sources: Vec<(u32, Vec<Curve>, f32)>,
    ) -> Result<u32, SlugError> {
        let source_weights = sources
            .iter()
            .map(|(weight, _, _)| *weight)
            .collect::<Vec<_>>();
        let base_weight = self.complements.weight_index(&source_weights)?;
        let source_advances = sources
            .iter()
            .map(|(_, _, advance)| *advance)
            .collect::<Vec<_>>();
        let source_curves = sources
            .into_iter()
            .map(|(weight, curves, _)| (weight, curves))
            .collect::<Vec<_>>();
        let atlas_glyph = self.builder.add_curve_glyph_with_sources_and_lines(
            base_curves,
            line_flags,
            base_weight,
            source_curves,
        )?;
        self.builder.set_glyph_source_advances(
            atlas_glyph,
            std::iter::once(base_advance).chain(source_advances),
        )?;
        self.glyphs.push((root, atlas_glyph));
        Ok(atlas_glyph)
    }

    pub fn add_exact_variant(
        &mut self,
        root: u32,
        source_index: u32,
        curves: Vec<Curve>,
        line_flags: Vec<bool>,
        advance: f32,
    ) -> Result<u32, SlugError> {
        let atlas_glyph = self.builder.add_curve_glyph_with_sources_and_lines(
            curves,
            line_flags,
            0,
            std::iter::empty(),
        )?;
        self.builder
            .set_glyph_source_advances(atlas_glyph, std::iter::once(advance))?;
        self.exact_glyphs.push((root, source_index, atlas_glyph));
        Ok(atlas_glyph)
    }

    pub fn finish(self) -> RetainedAtlasPage {
        RetainedAtlasPage::from_parts(
            self.builder.finish(),
            self.glyphs,
            self.exact_glyphs,
            self.axes,
            self.regions,
            self.complements.into_complements(),
        )
    }
}

pub fn compile_page(input: &PageInput, band_count: u32) -> Result<RetainedAtlasPage, SlugError> {
    let mut compiler = PageCompiler::new(band_count, input.axes.clone(), input.regions.clone())?;

    for (root, glyph) in &input.glyphs {
        let base = outline(*root, 0, &glyph.shape, &glyph.base_values)?;
        let samples = glyph
            .samples
            .iter()
            .enumerate()
            .map(|(source_index, (weight, values))| {
                Ok((
                    *weight,
                    outline(*root, source_index + 1, &glyph.shape, values)?,
                ))
            })
            .collect::<Result<Vec<_>, SlugError>>()?;
        let curves = compatible_curves(*root, &base, &samples)?;
        let sources = curves
            .sources
            .into_iter()
            .zip(&samples)
            .map(|((weight, curves), (_, outline))| (weight, curves, outline.advance))
            .collect();
        compiler.add_glyph(*root, curves.base, curves.line_flags, base.advance, sources)?;

        for exact in &glyph.exact_variants {
            let outline = outline(
                *root,
                exact.source_index as usize,
                &exact.shape,
                &exact.values,
            )?;
            let (curves, line_flags) = outline_curves(&outline)?;
            compiler.add_exact_variant(
                *root,
                exact.source_index,
                curves,
                line_flags,
                outline.advance,
            )?;
        }
    }

    Ok(compiler.finish())
}

#[derive(Clone, Copy, Debug)]
struct ProjectedPoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug)]
enum ProjectedSegment {
    Line([ProjectedPoint; 2]),
    Quadratic([ProjectedPoint; 3]),
    Cubic([ProjectedPoint; 4]),
}

#[derive(Clone, Debug)]
struct ProjectedOutline {
    advance: f32,
    segments: Vec<ProjectedSegment>,
}

struct CompatibleCurves {
    base: Vec<Curve>,
    line_flags: Vec<bool>,
    sources: Vec<(u32, Vec<Curve>)>,
}

fn outline(
    glyph_index: u32,
    source_index: usize,
    shape: &GlyphShape,
    values: &[f64],
) -> Result<ProjectedOutline, SlugError> {
    let expected = shape.value_count()?;
    if values.len() != expected {
        return Err(SlugError::RetainedShapeValueCountMismatch {
            expected,
            actual: values.len(),
        });
    }
    let advance = values[0] as f32;
    if !values[0].is_finite() || !advance.is_finite() {
        return Err(SlugError::NonFiniteVariableAdvance {
            glyph_index,
            source_index,
        });
    }

    let mut cursor = 1;
    let mut segments = Vec::with_capacity(shape.segments.len());
    for (segment_index, segment) in shape.segments.iter().enumerate() {
        let mut next_point = || {
            let point = ProjectedPoint {
                x: values[cursor],
                y: values[cursor + 1],
            };
            cursor += 2;
            if !point.x.is_finite()
                || !point.y.is_finite()
                || !(point.x as f32).is_finite()
                || !(point.y as f32).is_finite()
            {
                return Err(SlugError::NonFiniteCoordinate {
                    command_index: segment_index,
                });
            }
            Ok(point)
        };
        segments.push(match segment {
            GlyphSegment::Line => ProjectedSegment::Line([next_point()?, next_point()?]),
            GlyphSegment::Quadratic => {
                ProjectedSegment::Quadratic([next_point()?, next_point()?, next_point()?])
            }
            GlyphSegment::Cubic => ProjectedSegment::Cubic([
                next_point()?,
                next_point()?,
                next_point()?,
                next_point()?,
            ]),
        });
    }
    Ok(ProjectedOutline { advance, segments })
}

fn compatible_curves(
    glyph_index: u32,
    base: &ProjectedOutline,
    sources: &[(u32, ProjectedOutline)],
) -> Result<CompatibleCurves, SlugError> {
    for (_, source) in sources {
        if source.segments.len() != base.segments.len()
            || source
                .segments
                .iter()
                .zip(&base.segments)
                .any(|(left, right)| !same_segment_kind(left, right))
        {
            return Err(SlugError::VariableTopologyMismatch { glyph_index });
        }
    }
    let subdivisions = (0..base.segments.len())
        .map(|index| {
            std::iter::once(&base.segments[index])
                .chain(sources.iter().map(|(_, source)| &source.segments[index]))
                .map(cubic_subdivision_count)
                .max()
                .unwrap_or(1)
        })
        .collect::<Vec<_>>();
    let (base_curves, line_flags) = segments_to_curves(&base.segments, &subdivisions);
    let source_curves = sources
        .iter()
        .map(|(weight, source)| {
            (
                *weight,
                segments_to_curves(&source.segments, &subdivisions).0,
            )
        })
        .collect();
    Ok(CompatibleCurves {
        base: base_curves,
        line_flags,
        sources: source_curves,
    })
}

fn outline_curves(outline: &ProjectedOutline) -> Result<(Vec<Curve>, Vec<bool>), SlugError> {
    let subdivisions = outline
        .segments
        .iter()
        .map(cubic_subdivision_count)
        .collect::<Vec<_>>();
    Ok(segments_to_curves(&outline.segments, &subdivisions))
}

fn segments_to_curves(
    segments: &[ProjectedSegment],
    subdivisions: &[usize],
) -> (Vec<Curve>, Vec<bool>) {
    let mut curves = Vec::new();
    let mut line_flags = Vec::new();
    for (segment, subdivision_count) in segments.iter().zip(subdivisions) {
        match segment {
            ProjectedSegment::Line(points) => {
                curves.push(Curve::from_line(point(points[0]), point(points[1])));
                line_flags.push(true);
            }
            ProjectedSegment::Quadratic(points) => {
                curves.push(Curve {
                    p0: point(points[0]),
                    p1: point(points[1]),
                    p2: point(points[2]),
                });
                line_flags.push(false);
            }
            ProjectedSegment::Cubic(points) => {
                let approximated = Curve::from_cubic_with_subdivisions(
                    point(points[0]),
                    point(points[1]),
                    point(points[2]),
                    point(points[3]),
                    *subdivision_count,
                );
                line_flags.extend(std::iter::repeat_n(false, approximated.len()));
                curves.extend(approximated);
            }
        }
    }
    (curves, line_flags)
}

fn same_segment_kind(left: &ProjectedSegment, right: &ProjectedSegment) -> bool {
    matches!(
        (left, right),
        (ProjectedSegment::Line(_), ProjectedSegment::Line(_))
            | (
                ProjectedSegment::Quadratic(_),
                ProjectedSegment::Quadratic(_)
            )
            | (ProjectedSegment::Cubic(_), ProjectedSegment::Cubic(_))
    )
}

fn cubic_subdivision_count(segment: &ProjectedSegment) -> usize {
    let ProjectedSegment::Cubic(points) = segment else {
        return 1;
    };
    let converted = points.map(point);
    Curve::cubic_subdivision_count(converted[0], converted[1], converted[2], converted[3])
}

fn point(value: ProjectedPoint) -> Point {
    Point::new(value.x as f32, value.y as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_weights_keep_glyph_region_complements_independent() {
        let page = RetainedAtlasPage::from_parts(
            VariableAtlas::default(),
            Vec::new(),
            Vec::new(),
            vec![AtlasAxis::new(Vec::new(), -1.0, 0.0, 1.0, Vec::new())],
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
            descriptor.weights(&[1.0]).unwrap(),
            vec![1.0, 1.0, 0.0, 0.0, 1.0]
        );
    }

    #[test]
    fn compiles_variable_and_exact_retained_inputs() {
        let shape = GlyphShape::new(vec![GlyphSegment::Line]);
        let input = PageInput {
            glyphs: vec![(
                7,
                GlyphInput {
                    shape: shape.clone(),
                    base_values: vec![500.0, 0.0, 0.0, 100.0, 0.0].into_boxed_slice(),
                    samples: vec![(1, vec![600.0, 0.0, 0.0, 200.0, 0.0].into_boxed_slice())],
                    exact_variants: vec![ExactVariant {
                        source_index: 2,
                        shape,
                        values: vec![700.0, 0.0, 0.0, 300.0, 0.0].into_boxed_slice(),
                    }],
                },
            )],
            axes: vec![AtlasAxis::new(Vec::new(), 0.0, 0.0, 1.0, Vec::new())],
            regions: vec![AtlasRegion::new(vec![RegionAxis {
                start: 0,
                peak: 16384,
                end: 16384,
            }])],
        };

        let page = compile_page(&input, crate::DEFAULT_BAND_COUNT).unwrap();
        let mut compiler = PageCompiler::new(
            crate::DEFAULT_BAND_COUNT,
            input.axes.clone(),
            input.regions.clone(),
        )
        .unwrap();
        compiler
            .add_glyph(
                7,
                vec![Curve::from_line(
                    Point::new(0.0, 0.0),
                    Point::new(100.0, 0.0),
                )],
                vec![true],
                500.0,
                vec![(
                    1,
                    vec![Curve::from_line(
                        Point::new(0.0, 0.0),
                        Point::new(200.0, 0.0),
                    )],
                    600.0,
                )],
            )
            .unwrap();
        compiler
            .add_exact_variant(
                7,
                2,
                vec![Curve::from_line(
                    Point::new(0.0, 0.0),
                    Point::new(300.0, 0.0),
                )],
                vec![true],
                700.0,
            )
            .unwrap();
        let streamed_page = compiler.finish();

        assert_eq!(streamed_page, page);

        let weights = page.weights(&[1.0]).unwrap();
        let default_glyph = page.glyphs()[0].1;
        let exact_glyph = page.exact_glyphs()[0].2;

        assert_eq!(
            page.atlas()
                .resolve_advance_with_weights(default_glyph, &weights),
            Ok(600.0)
        );
        assert_eq!(
            page.atlas()
                .resolve_advance_with_weights(exact_glyph, &[1.0]),
            Ok(700.0)
        );
        assert_eq!(page.glyphs(), &[(7, default_glyph)]);
        assert_eq!(page.exact_glyphs(), &[(7, 2, exact_glyph)]);
    }
}
