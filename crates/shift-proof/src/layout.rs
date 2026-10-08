//! Shapes a definition's sections and places them on one page.
//!
//! Page coordinates are pixels with the origin at the top-left and y down.
//! Each row keeps its run in font units plus the scale and baseline that
//! place it. Ported from Andrea Fomera's `shift proof` prototype.

use shift_specimen::shaping::{ShapedRun, ShapingFont, VerticalMetrics};

use crate::definition::{
    parse_location, Across, AcrossKeyword, GlyphKeyword, GlyphSelection, ProofDefinition,
    ProofSection,
};
use crate::font::ProofFont;
use crate::label::LABEL_ADVANCE;
use crate::ProofError;

/// Space around the content, in pixels.
pub const MARGIN: f32 = 24.0;
/// Space between the label column and the text, in pixels.
const LABEL_GAP: f32 = 16.0;
/// Extra space between rows, as a fraction of the row's size.
const ROW_GAP_EM: f32 = 0.25;
/// Space between sections, in pixels; a divider sits in the middle.
const SECTION_GAP: f32 = 32.0;
/// Space between glyphs in a glyph grid, as a fraction of the size.
const GRID_GAP_EM: f32 = 0.2;
/// Page width used to wrap glyph grids when the definition sets none.
const GRID_WIDTH: f32 = 1200.0;
/// Narrowest page, so tiny proofs still have room for labels.
const MIN_WIDTH: f32 = 160.0;

/// A laid-out proof, ready for any renderer.
pub struct ProofPage {
    pub width: u32,
    pub height: u32,
    pub rows: Vec<Row>,
    pub guides: Vec<GuideLine>,
    /// Vertical positions of the lines between sections, in pixels.
    pub dividers: Vec<f32>,
    /// Glyph names a `glyphs` section asked for that the font lacks.
    pub missing_glyphs: Vec<(usize, String)>,
    pub units_per_em: u16,
}

/// One rendered row of glyphs.
pub struct Row {
    /// Index of the section this row belongs to.
    pub section: usize,
    pub text: String,
    /// Pixels per em.
    pub size: f32,
    /// Pixels per font unit.
    pub scale: f32,
    /// Pen origin of the text, in pixels.
    pub origin_x: f32,
    /// Baseline, in pixels from the top.
    pub baseline: f32,
    pub run: ShapedRun,
    /// Digits drawn in the label column, such as the size or an axis value.
    pub label: String,
    /// Every axis with the user-space value this row was shaped at.
    pub location: Vec<(String, f32)>,
    /// Characters of `text` the font does not map, in order of first appearance.
    pub missing_characters: Vec<char>,
    pub metrics: VerticalMetrics,
}

/// A horizontal metric guide.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Guide {
    Ascender,
    CapHeight,
    XHeight,
    Baseline,
    Descender,
}

impl Guide {
    pub const ALL: [Guide; 5] = [
        Self::Ascender,
        Self::CapHeight,
        Self::XHeight,
        Self::Baseline,
        Self::Descender,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::Ascender => "ascender",
            Self::CapHeight => "capHeight",
            Self::XHeight => "xHeight",
            Self::Baseline => "baseline",
            Self::Descender => "descender",
        }
    }

    pub fn color(self) -> [u8; 3] {
        match self {
            Self::Ascender => [148, 103, 189],
            Self::CapHeight => [23, 190, 207],
            Self::XHeight => [44, 160, 44],
            Self::Baseline => [31, 119, 180],
            Self::Descender => [255, 127, 14],
        }
    }

    fn position(self, metrics: &VerticalMetrics) -> Option<f32> {
        match self {
            Self::Ascender => Some(metrics.ascender),
            Self::CapHeight => metrics.cap_height,
            Self::XHeight => metrics.x_height,
            Self::Baseline => Some(0.0),
            Self::Descender => Some(metrics.descender),
        }
    }
}

/// A guide placed on the page, in pixels.
pub struct GuideLine {
    pub guide: Guide,
    pub y: f32,
    pub x0: f32,
    pub x1: f32,
}

/// What one row asks to set before it is shaped.
struct RowSpec {
    content: RowContent,
    size: f32,
    location: Vec<(String, f32)>,
    label: String,
}

enum RowContent {
    Text(String),
    Glyphs(Vec<u32>),
}

/// Shapes every section of `definition` and lays them out top to bottom.
///
/// # Errors
///
/// Returns an error for an unreadable font or an invalid location.
pub fn layout(definition: &ProofDefinition, font: &ProofFont) -> Result<ProofPage, ProofError> {
    let base =
        ShapingFont::new(font.data()).map_err(|error| ProofError::Load(error.to_string()))?;
    let units_per_em = base.metrics().units_per_em;
    let page_width = definition.page.width.map(|width| width as f32);

    let mut missing_glyphs = Vec::new();
    let mut sections: Vec<Vec<RowSpec>> = Vec::new();
    for (index, section) in definition.sections.iter().enumerate() {
        sections.push(row_specs(index, section, font, &base, &mut missing_glyphs)?);
    }

    let label_chars = sections
        .iter()
        .flatten()
        .map(|spec| spec.label.len())
        .max()
        .unwrap_or(0);
    let origin_x = MARGIN + label_chars as f32 * LABEL_ADVANCE + LABEL_GAP;

    let mut rows = Vec::new();
    let mut guides_for = Vec::new();
    let mut dividers = Vec::new();
    let mut cursor = MARGIN;
    for (section_index, specs) in sections.into_iter().enumerate() {
        if section_index > 0 {
            dividers.push(cursor + SECTION_GAP / 2.0);
            cursor += SECTION_GAP;
        }
        let largest = specs.iter().map(|spec| spec.size).fold(0.0_f32, f32::max);
        let mut guided = false;
        for spec in specs {
            let shaping = base
                .at(&spec.location)
                .map_err(|error| ProofError::Location(error.to_string()))?;
            let metrics = shaping.metrics();
            let scale = spec.size / f32::from(metrics.units_per_em);
            let available = page_width.map(|width| (width - origin_x - MARGIN).max(1.0) / scale);
            let parts = match &spec.content {
                RowContent::Text(text) => wrap(&shaping, text, available),
                RowContent::Glyphs(ids) => {
                    let grid_width = page_width.unwrap_or(GRID_WIDTH);
                    let available = (grid_width - origin_x - MARGIN).max(1.0) / scale;
                    grid(&shaping, ids, available, spec.size / scale * GRID_GAP_EM)
                }
            };
            for (text, run) in parts {
                let baseline = cursor + metrics.ascender * scale;
                cursor = baseline - metrics.descender * scale + spec.size * ROW_GAP_EM;
                if definition.page.metrics && !guided && spec.size == largest {
                    guides_for.push(rows.len());
                    guided = true;
                }
                rows.push(Row {
                    section: section_index,
                    missing_characters: shaping.missing_characters(&text),
                    text,
                    size: spec.size,
                    scale,
                    origin_x,
                    baseline,
                    run,
                    label: spec.label.clone(),
                    location: shaping.location().to_vec(),
                    metrics,
                });
            }
        }
    }

    let content_right = rows
        .iter()
        .map(|row| row.origin_x + row.run.advance * row.scale)
        .fold(0.0_f32, f32::max);
    let width = page_width
        .unwrap_or((content_right + MARGIN).max(MIN_WIDTH))
        .ceil();
    let height = (cursor + MARGIN).ceil();
    let guides = guides_for
        .into_iter()
        .flat_map(|index| {
            let row = &rows[index];
            Guide::ALL.into_iter().filter_map(move |guide| {
                let height = guide.position(&row.metrics)?;
                Some(GuideLine {
                    guide,
                    y: row.baseline - height * row.scale,
                    x0: row.origin_x,
                    x1: width - MARGIN,
                })
            })
        })
        .collect();

    Ok(ProofPage {
        width: width as u32,
        height: height as u32,
        rows,
        guides,
        dividers,
        missing_glyphs,
        units_per_em,
    })
}

fn row_specs(
    index: usize,
    section: &ProofSection,
    font: &ProofFont,
    base: &ShapingFont,
    missing_glyphs: &mut Vec<(usize, String)>,
) -> Result<Vec<RowSpec>, ProofError> {
    let location = |text: &Option<String>| -> Result<Vec<(String, f32)>, ProofError> {
        text.as_deref()
            .map(parse_location)
            .transpose()
            .map(Option::unwrap_or_default)
    };

    Ok(match section {
        ProofSection::Text {
            text,
            size,
            locations,
        } => {
            if locations.is_empty() {
                vec![RowSpec {
                    content: RowContent::Text(text.clone()),
                    size: *size,
                    location: Vec::new(),
                    label: size_label(*size),
                }]
            } else {
                let parsed = locations
                    .iter()
                    .map(|location| parse_location(location))
                    .collect::<Result<Vec<_>, _>>()?;
                location_rows(text, *size, parsed)
            }
        }
        ProofSection::Waterfall {
            text,
            sizes,
            location: at,
        } => {
            let location = location(at)?;
            sizes
                .iter()
                .map(|size| RowSpec {
                    content: RowContent::Text(text.clone()),
                    size: *size,
                    location: location.clone(),
                    label: size_label(*size),
                })
                .collect()
        }
        ProofSection::Glyphs {
            glyphs,
            size,
            location: at,
        } => {
            let ids = match glyphs {
                GlyphSelection::Keyword(GlyphKeyword::Drawn) => drawn_glyphs(base),
                GlyphSelection::Names(names) => names
                    .iter()
                    .filter_map(|name| {
                        let id = base.glyph_by_name(name);
                        if id.is_none() {
                            missing_glyphs.push((index, name.clone()));
                        }
                        id
                    })
                    .collect(),
            };
            vec![RowSpec {
                content: RowContent::Glyphs(ids),
                size: *size,
                location: location(at)?,
                label: size_label(*size),
            }]
        }
        ProofSection::Locations { text, across, size } => {
            let locations = match across {
                Across::Keyword(AcrossKeyword::Sources) => font
                    .sources()?
                    .iter()
                    .map(|(_, location)| location.clone())
                    .collect(),
                Across::Keyword(AcrossKeyword::Instances) => base
                    .named_instances()
                    .into_iter()
                    .map(|instance| instance.location)
                    .collect(),
                Across::Axis { axis, steps } => {
                    let range = base
                        .axes()
                        .into_iter()
                        .find(|candidate| &candidate.tag == axis)
                        .ok_or_else(|| {
                            ProofError::Location(format!("the font has no {axis:?} axis"))
                        })?;
                    (0..*steps)
                        .map(|step| {
                            let t = step as f32 / (*steps - 1) as f32;
                            vec![(axis.clone(), range.min + (range.max - range.min) * t)]
                        })
                        .collect()
                }
            };
            location_rows(text, *size, locations)
        }
    })
}

/// One row per location, labelled by the value of the first axis that varies.
fn location_rows(text: &str, size: f32, locations: Vec<Vec<(String, f32)>>) -> Vec<RowSpec> {
    let varying = locations.first().and_then(|first| {
        first.iter().position(|(tag, value)| {
            locations.iter().any(|location| {
                location
                    .iter()
                    .any(|(other_tag, other)| other_tag == tag && other != value)
            })
        })
    });
    locations
        .into_iter()
        .map(|location| RowSpec {
            content: RowContent::Text(text.to_string()),
            size,
            label: varying
                .and_then(|index| location.get(index))
                .map_or_else(|| size_label(size), |(_, value)| size_label(*value)),
            location,
        })
        .collect()
}

fn drawn_glyphs(font: &ShapingFont) -> Vec<u32> {
    (1..font.glyph_count())
        .filter(|id| !font.glyph_run(&[*id]).glyphs[0].segments.is_empty())
        .collect()
}

/// Formats a number for a label, without a fractional part when whole.
pub fn size_label(value: f32) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}

/// Splits `text` greedily at spaces so each part fits `max_advance` font
/// units; a single word wider than the limit keeps its own row.
fn wrap(font: &ShapingFont, text: &str, max_advance: Option<f32>) -> Vec<(String, ShapedRun)> {
    let Some(max_advance) = max_advance else {
        return vec![(text.to_string(), font.shape(text))];
    };

    let mut parts = Vec::new();
    let mut current: Option<(String, ShapedRun)> = None;
    for word in text.split(' ') {
        let candidate = match &current {
            Some((line, _)) => format!("{line} {word}"),
            None => word.to_string(),
        };
        let run = font.shape(&candidate);
        if run.advance <= max_advance {
            current = Some((candidate, run));
            continue;
        }
        match current.take() {
            Some(fitted) => {
                parts.push(fitted);
                current = Some((word.to_string(), font.shape(word)));
            }
            None => parts.push((candidate, run)),
        }
    }
    parts.extend(current);
    parts
}

/// Splits glyphs into rows of at most `max_advance` font units, with `gap`
/// font units between glyphs.
fn grid(font: &ShapingFont, ids: &[u32], max_advance: f32, gap: f32) -> Vec<(String, ShapedRun)> {
    let mut rows: Vec<Vec<u32>> = vec![Vec::new()];
    let mut width = 0.0;
    for id in ids {
        let advance = font.glyph_run(&[*id]).advance + gap;
        if width + advance > max_advance && !rows.last().unwrap().is_empty() {
            rows.push(Vec::new());
            width = 0.0;
        }
        rows.last_mut().unwrap().push(*id);
        width += advance;
    }
    rows.into_iter()
        .filter(|row| !row.is_empty())
        .map(|row| {
            let mut run = font.glyph_run(&row);
            let mut offset = 0.0;
            for glyph in &mut run.glyphs {
                shift_glyph(glyph, offset);
                offset += gap;
            }
            run.advance += gap * row.len().saturating_sub(1) as f32;
            (String::new(), run)
        })
        .collect()
}

fn shift_glyph(glyph: &mut shift_specimen::shaping::ShapedGlyph, dx: f32) {
    use shift_specimen::shaping::Segment;
    glyph.x += dx;
    for segment in &mut glyph.segments {
        *segment = match *segment {
            Segment::Move(x, y) => Segment::Move(x + dx, y),
            Segment::Line(x, y) => Segment::Line(x + dx, y),
            Segment::Quad(cx, cy, x, y) => Segment::Quad(cx + dx, cy, x + dx, y),
            Segment::Cubic(cx0, cy0, cx1, cy1, x, y) => {
                Segment::Cubic(cx0 + dx, cy0, cx1 + dx, cy1, x + dx, y)
            }
            Segment::Close => Segment::Close,
        };
    }
}
