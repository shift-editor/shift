//! Shapes a definition's sections and places them on one page.
//!
//! Layout makes every design decision and produces a display list of
//! [`Mark`]s in CSS pixels (origin top-left, y down); the SVG and PNG
//! renderers only paint it. The page follows common proofing practice: an
//! identifying header, a titled section per definition entry, captions in a
//! left gutter, and the proofed font as the only black ink. Wrapping is
//! ported from Andrea Fomera's `shift proof` prototype.

use shift_specimen::shaping::{Segment, ShapedGlyph, ShapedRun, ShapingFont, VerticalMetrics};

use crate::definition::{
    parse_location, Across, AcrossKeyword, GlyphKeyword, GlyphSelection, ProofDefinition,
    ProofSection, UserLocation,
};
use crate::font::ProofFont;
use crate::ui::{Align, TextStyle, UiType};
use crate::ProofError;

/// An sRGB colour.
pub type Rgb = [u8; 3];

pub const BACKGROUND: Rgb = [255, 255, 255];
const INK: Rgb = [17, 17, 17];
/// Missing glyphs read as absent rather than as part of the design.
const MISSING: Rgb = [196, 196, 196];
const MUTED: Rgb = [128, 128, 128];
const HAIRLINE: Rgb = [214, 214, 214];
/// The one accent, for metric labels.
const ACCENT: Rgb = [229, 49, 122];
const CELL: Rgb = [245, 245, 245];

/// Space around the content.
const MARGIN: f32 = 40.0;
/// Space between a caption's right edge and the sample.
const GUTTER_PAD: f32 = 20.0;
const MIN_GUTTER: f32 = 64.0;
/// Space above each section's rule.
const SECTION_GAP: f32 = 32.0;
/// Space between a section title's baseline and the first row's top.
const TITLE_GAP: f32 = 18.0;
/// Extra space between rows, as a fraction of the row's size.
const ROW_GAP_EM: f32 = 0.2;
/// How far metric guides reach past the sample on each side.
const GUIDE_OVERHANG: f32 = 8.0;
const CELL_GAP: f32 = 8.0;
const CELL_PAD: f32 = 10.0;
/// Height of the name strip under a glyph cell.
const CELL_NAME_HEIGHT: f32 = 20.0;
/// Width that wraps a glyph grid when the definition sets no page width.
const GRID_WIDTH: f32 = 1200.0;
const MIN_WIDTH: f32 = 320.0;

const HEADER: TextStyle = TextStyle {
    size: 13.0,
    bold: true,
    color: INK,
    class: "header",
};
const HEADER_DETAIL: TextStyle = TextStyle {
    size: 11.0,
    bold: false,
    color: MUTED,
    class: "header",
};
const TITLE: TextStyle = TextStyle {
    size: 11.0,
    bold: true,
    color: INK,
    class: "title",
};
const TITLE_DETAIL: TextStyle = TextStyle {
    size: 11.0,
    bold: false,
    color: MUTED,
    class: "title",
};
const CAPTION: TextStyle = TextStyle {
    size: 10.0,
    bold: false,
    color: MUTED,
    class: "caption",
};
const GUIDE_LABEL: TextStyle = TextStyle {
    size: 9.0,
    bold: false,
    color: ACCENT,
    class: "guide-label",
};
const CELL_NAME: TextStyle = TextStyle {
    size: 9.0,
    bold: false,
    color: MUTED,
    class: "cell-name",
};

/// A laid-out proof, ready for any renderer.
pub struct ProofPage {
    /// Size in CSS pixels.
    pub width: u32,
    pub height: u32,
    pub marks: Vec<Mark>,
    /// What each row set, for the report.
    pub rows: Vec<Row>,
    /// Glyph names a `glyphs` section asked for that the font lacks, by section.
    pub missing_glyphs: Vec<(usize, String)>,
    pub units_per_em: u16,
}

/// One thing to paint. Renderers paint rectangles, then lines, then runs.
pub enum Mark {
    Rect {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        fill: Option<Rgb>,
        /// A dashed outline, for empty cells.
        dashed: Option<Rgb>,
    },
    Line {
        class: &'static str,
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        color: Rgb,
    },
    Run(RunMark),
}

/// Outlines filled in one colour, in font units placed by `x`, `baseline`, and `scale`.
pub struct RunMark {
    pub class: &'static str,
    /// The text these outlines spell, for SVG readers and tests.
    pub text: String,
    pub color: Rgb,
    pub x: f32,
    pub baseline: f32,
    /// Pixels per font unit.
    pub scale: f32,
    pub segments: Vec<Segment>,
}

/// One row of the proofed font, as the report describes it.
pub struct Row {
    /// Index of the section this row belongs to.
    pub section: usize,
    /// The text set; empty for a glyph grid row.
    pub text: String,
    /// Pixels per em.
    pub size: f32,
    /// Baseline, in pixels from the top.
    pub baseline: f32,
    pub run: ShapedRun,
    /// Every axis with the user-space value this row was shaped at.
    pub location: UserLocation,
    /// Characters of `text` the font does not map, in order of first appearance.
    pub missing_characters: Vec<char>,
}

/// A section resolved to what it will set.
struct SectionPlan {
    title: String,
    detail: String,
    body: Body,
}

enum Body {
    Rows(Vec<RowSpec>),
    Grid {
        items: Vec<GridItem>,
        size: f32,
        location: UserLocation,
    },
}

struct RowSpec {
    text: String,
    size: f32,
    location: UserLocation,
    caption: String,
}

struct GridItem {
    name: String,
    glyph: Option<u32>,
}

/// Right-aligned or full-width marks, placed once the page width is known.
enum Deferred {
    RightText(String, TextStyle, f32),
    Rule(f32),
}

/// Shapes every section of `definition` and lays them out top to bottom.
/// `date` goes in the header when given; leave it out for reproducible output.
///
/// # Errors
///
/// Returns an error for an unreadable font or an invalid location.
pub fn layout(
    definition: &ProofDefinition,
    font: &ProofFont,
    date: Option<&str>,
) -> Result<ProofPage, ProofError> {
    let base =
        ShapingFont::new(font.data()).map_err(|error| ProofError::Load(error.to_string()))?;
    let mut missing_glyphs = Vec::new();
    let plans = definition
        .sections
        .iter()
        .enumerate()
        .map(|(index, section)| plan(index, section, font, &base, &mut missing_glyphs))
        .collect::<Result<Vec<_>, _>>()?;

    let mut page = PageBuilder::new(&base, definition, &plans);
    page.header(&base, font.source_name(), date);
    for (index, plan) in plans.iter().enumerate() {
        page.section(index, plan, &base)?;
    }
    Ok(page.finish(missing_glyphs, base.metrics().units_per_em))
}

fn plan(
    index: usize,
    section: &ProofSection,
    font: &ProofFont,
    base: &ShapingFont,
    missing_glyphs: &mut Vec<(usize, String)>,
) -> Result<SectionPlan, ProofError> {
    let optional = |text: &Option<String>| -> Result<UserLocation, ProofError> {
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
            let rows = if locations.is_empty() {
                vec![RowSpec {
                    text: text.clone(),
                    size: *size,
                    location: Vec::new(),
                    caption: px(*size),
                }]
            } else {
                locations
                    .iter()
                    .map(|location| {
                        let location = parse_location(location)?;
                        Ok(RowSpec {
                            text: text.clone(),
                            size: *size,
                            caption: location_caption(&location),
                            location,
                        })
                    })
                    .collect::<Result<_, ProofError>>()?
            };
            SectionPlan {
                title: "Text".into(),
                detail: px(*size),
                body: Body::Rows(rows),
            }
        }
        ProofSection::Waterfall {
            text,
            sizes,
            location,
        } => {
            let location = optional(location)?;
            SectionPlan {
                title: "Waterfall".into(),
                detail: if location.is_empty() {
                    "default location".into()
                } else {
                    location_caption(&location)
                },
                body: Body::Rows(
                    sizes
                        .iter()
                        .map(|size| RowSpec {
                            text: text.clone(),
                            size: *size,
                            location: location.clone(),
                            caption: px(*size),
                        })
                        .collect(),
                ),
            }
        }
        ProofSection::Glyphs {
            glyphs,
            size,
            location,
        } => {
            let items: Vec<GridItem> = match glyphs {
                GlyphSelection::Keyword(GlyphKeyword::Drawn) => (1..base.glyph_count())
                    .filter(|id| !base.glyph_run(&[*id]).glyphs[0].segments.is_empty())
                    .map(|id| GridItem {
                        name: base.glyph_name(id).unwrap_or_else(|| format!("gid{id}")),
                        glyph: Some(id),
                    })
                    .collect(),
                GlyphSelection::Names(names) => names
                    .iter()
                    .map(|name| {
                        let glyph = base.glyph_by_name(name);
                        if glyph.is_none() {
                            missing_glyphs.push((index, name.clone()));
                        }
                        GridItem {
                            name: name.clone(),
                            glyph,
                        }
                    })
                    .collect(),
            };
            let location = optional(location)?;
            let mut detail = format!("{} glyphs · {}", items.len(), px(*size));
            if !location.is_empty() {
                detail = format!("{detail} · {}", location_caption(&location));
            }
            SectionPlan {
                title: "Glyphs".into(),
                detail,
                body: Body::Grid {
                    items,
                    size: *size,
                    location,
                },
            }
        }
        ProofSection::Locations { text, across, size } => {
            let (title, locations): (String, Vec<(String, UserLocation)>) = match across {
                Across::Keyword(AcrossKeyword::Sources) => {
                    ("Sources".into(), font.sources()?.to_vec())
                }
                Across::Keyword(AcrossKeyword::Instances) => (
                    "Instances".into(),
                    base.named_instances()
                        .into_iter()
                        .map(|instance| (instance.name, instance.location))
                        .collect(),
                ),
                Across::Axis { axis, steps } => {
                    let range = base
                        .axes()
                        .into_iter()
                        .find(|candidate| &candidate.tag == axis)
                        .ok_or_else(|| {
                            ProofError::Location(format!("the font has no {axis:?} axis"))
                        })?;
                    let locations = (0..*steps)
                        .map(|step| {
                            let t = step as f32 / (*steps - 1) as f32;
                            let location =
                                vec![(axis.clone(), range.min + (range.max - range.min) * t)];
                            (location_caption(&location), location)
                        })
                        .collect();
                    (format!("{axis} axis"), locations)
                }
            };
            SectionPlan {
                title,
                detail: px(*size),
                body: Body::Rows(
                    locations
                        .into_iter()
                        .map(|(caption, location)| RowSpec {
                            text: text.clone(),
                            size: *size,
                            location,
                            caption,
                        })
                        .collect(),
                ),
            }
        }
    })
}

struct PageBuilder<'a> {
    ui: UiType,
    definition: &'a ProofDefinition,
    marks: Vec<Mark>,
    rows: Vec<Row>,
    deferred: Vec<Deferred>,
    /// Left edge of the samples; captions end `GUTTER_PAD` before it.
    origin_x: f32,
    cursor: f32,
    /// Rightmost edge of anything drawn so far.
    right: f32,
}

impl<'a> PageBuilder<'a> {
    fn new(base: &ShapingFont, definition: &'a ProofDefinition, plans: &[SectionPlan]) -> Self {
        let ui = UiType::new();
        let mut gutter = plans
            .iter()
            .filter_map(|plan| match &plan.body {
                Body::Rows(rows) => Some(rows),
                Body::Grid { .. } => None,
            })
            .flatten()
            .map(|row| ui.width(&row.caption, CAPTION))
            .fold(0.0_f32, f32::max);
        if definition.page.metrics {
            for (_, label) in guide_labels(&base.metrics()) {
                gutter = gutter.max(ui.width(&label, GUIDE_LABEL));
            }
        }
        let origin_x = MARGIN + (gutter + GUTTER_PAD).max(MIN_GUTTER);
        Self {
            ui,
            definition,
            marks: Vec::new(),
            rows: Vec::new(),
            deferred: Vec::new(),
            origin_x,
            cursor: MARGIN,
            right: 0.0,
        }
    }

    fn page_width(&self) -> Option<f32> {
        self.definition.page.width.map(|width| width as f32)
    }

    fn text(&mut self, text: &str, style: TextStyle, x: f32, baseline: f32, align: Align) {
        if matches!(align, Align::Left) {
            self.right = self.right.max(x + self.ui.width(text, style));
        }
        let mark = self.ui.mark(text, style, x, baseline, align);
        self.marks.push(Mark::Run(mark));
    }

    /// Reserves room for right-aligned `text` across from left content ending at `left_end`.
    fn right_text(&mut self, text: &str, style: TextStyle, baseline: f32, left_end: f32) {
        if text.is_empty() {
            return;
        }
        self.right = self.right.max(left_end + 24.0 + self.ui.width(text, style));
        self.deferred
            .push(Deferred::RightText(text.to_string(), style, baseline));
    }

    fn header(&mut self, font: &ShapingFont, source: Option<&str>, date: Option<&str>) {
        let family = font.name(16).or_else(|| font.name(1)).unwrap_or_default();
        let style = font.name(17).or_else(|| font.name(2)).unwrap_or_default();
        let title = format!("{family} {style}").trim().to_string();
        let title = if title.is_empty() {
            "Untitled".to_string()
        } else {
            title
        };

        let mut details = Vec::new();
        if let Some(version) = font.name(5) {
            details.push(version.trim_start_matches("Version ").to_string());
        }
        if let Some(source) = source {
            details.push(source.to_string());
        }
        details.push(format!("{} UPM", font.metrics().units_per_em));
        details.push(format!("{} glyphs", font.glyph_count()));
        let axes = font.axes();
        if !axes.is_empty() {
            details.push(
                axes.iter()
                    .map(|axis| format!("{} {}–{}", axis.tag, number(axis.min), number(axis.max)))
                    .collect::<Vec<_>>()
                    .join(", "),
            );
        }

        let title_baseline = self.cursor + 10.0;
        self.text(&title, HEADER, MARGIN, title_baseline, Align::Left);
        let title_end = MARGIN + self.ui.width(&title, HEADER);
        if let Some(date) = date {
            self.right_text(date, HEADER_DETAIL, title_baseline, title_end);
        }
        let details_baseline = title_baseline + 18.0;
        self.text(
            &details.join("  ·  "),
            HEADER_DETAIL,
            MARGIN,
            details_baseline,
            Align::Left,
        );
        self.cursor = details_baseline;
    }

    fn section(
        &mut self,
        index: usize,
        plan: &SectionPlan,
        base: &ShapingFont,
    ) -> Result<(), ProofError> {
        self.cursor += SECTION_GAP;
        self.deferred.push(Deferred::Rule(self.cursor));
        let title_baseline = self.cursor + 18.0;
        self.text(&plan.title, TITLE, MARGIN, title_baseline, Align::Left);
        let title_end = MARGIN + self.ui.width(&plan.title, TITLE);
        self.right_text(&plan.detail, TITLE_DETAIL, title_baseline, title_end);
        self.cursor = title_baseline + TITLE_GAP;

        match &plan.body {
            Body::Rows(specs) => self.rows(index, specs, base),
            Body::Grid {
                items,
                size,
                location,
            } => self.grid(index, items, *size, location, base),
        }
    }

    fn rows(
        &mut self,
        index: usize,
        specs: &[RowSpec],
        base: &ShapingFont,
    ) -> Result<(), ProofError> {
        let largest = specs.iter().map(|spec| spec.size).fold(0.0_f32, f32::max);
        let mut guided = !self.definition.page.metrics;
        let mut gap = 0.0;
        for spec in specs {
            let shaping = base
                .at(&spec.location)
                .map_err(|error| ProofError::Location(error.to_string()))?;
            let metrics = shaping.metrics();
            let scale = spec.size / f32::from(metrics.units_per_em);
            let available = self
                .page_width()
                .map(|width| (width - self.origin_x - MARGIN).max(1.0) / scale);
            let lines = wrap(&shaping, &spec.text, available);
            for (line, (text, run)) in lines.into_iter().enumerate() {
                let baseline = self.cursor + metrics.ascender * scale;
                if line == 0 && !spec.caption.is_empty() {
                    let caption_x = self.origin_x - GUTTER_PAD;
                    self.text(&spec.caption, CAPTION, caption_x, baseline, Align::Right);
                }
                if !guided && spec.size == largest {
                    self.guides(&metrics, scale, baseline, run.advance * scale);
                    guided = true;
                }
                self.ink(&run.glyphs, self.origin_x, baseline, scale, &text);
                self.right = self.right.max(self.origin_x + run.advance * scale);
                self.rows.push(Row {
                    section: index,
                    missing_characters: shaping.missing_characters(&text),
                    text,
                    size: spec.size,
                    baseline,
                    run,
                    location: shaping.location().to_vec(),
                });
                gap = spec.size * ROW_GAP_EM;
                self.cursor = baseline - metrics.descender * scale + gap;
            }
        }
        self.cursor -= gap;
        Ok(())
    }

    /// Adds runs for `glyphs`, split so missing glyphs paint in their own colour.
    fn ink(&mut self, glyphs: &[ShapedGlyph], x: f32, baseline: f32, scale: f32, text: &str) {
        let mut start = 0;
        for end in 1..=glyphs.len() {
            if end < glyphs.len() && glyphs[end].missing == glyphs[start].missing {
                continue;
            }
            let missing = glyphs[start].missing;
            self.marks.push(Mark::Run(RunMark {
                class: if missing { "missing" } else { "ink" },
                text: text.to_string(),
                color: if missing { MISSING } else { INK },
                x,
                baseline,
                scale,
                segments: glyphs[start..end]
                    .iter()
                    .flat_map(|glyph| glyph.segments.iter().copied())
                    .collect(),
            }));
            start = end;
        }
    }

    /// Hairlines at each vertical metric under the sample, labelled in the
    /// gutter. Labels that would collide move apart, with a leader to their line.
    fn guides(&mut self, metrics: &VerticalMetrics, scale: f32, baseline: f32, width: f32) {
        let x0 = self.origin_x - GUIDE_OVERHANG;
        let x1 = self.origin_x + width + GUIDE_OVERHANG;
        let label_right = self.origin_x - GUTTER_PAD;
        let label_height = GUIDE_LABEL.size * 0.75;

        // Labels stack away from the row caption, which sits on the baseline.
        let mut above_top = baseline - CAPTION.size * 0.75 - 3.0;
        let mut below_bottom = baseline + 3.0;
        for (height, label) in guide_labels(metrics) {
            let y = baseline - height * scale;
            self.marks.push(Mark::Line {
                class: "guide",
                x0,
                y0: y,
                x1,
                y1: y,
                color: HAIRLINE,
            });
            if height == 0.0 {
                continue;
            }
            let center = if height > 0.0 {
                let center = y.min(above_top - label_height / 2.0);
                above_top = center - label_height / 2.0 - 3.0;
                center
            } else {
                let center = y.max(below_bottom + label_height / 2.0);
                below_bottom = center + label_height / 2.0 + 3.0;
                center
            };
            self.text(
                &label,
                GUIDE_LABEL,
                label_right,
                center + label_height / 2.0,
                Align::Right,
            );
            if (center - y).abs() > 0.5 {
                self.marks.push(Mark::Line {
                    class: "leader",
                    x0: label_right + 3.0,
                    y0: center,
                    x1: x0,
                    y1: y,
                    color: ACCENT,
                });
            }
        }
    }

    fn grid(
        &mut self,
        index: usize,
        items: &[GridItem],
        size: f32,
        location: &UserLocation,
        base: &ShapingFont,
    ) -> Result<(), ProofError> {
        let shaping = base
            .at(location)
            .map_err(|error| ProofError::Location(error.to_string()))?;
        let metrics = shaping.metrics();
        let scale = size / f32::from(metrics.units_per_em);
        let cell_width = (size * 1.2).max(64.0);
        // Cells grow to fit marks and other ink beyond the vertical metrics.
        let (bottom, top) = items
            .iter()
            .filter_map(|item| item.glyph)
            .flat_map(|glyph| shaping.glyph_run(&[glyph]).glyphs)
            .flat_map(|glyph| glyph.segments)
            .filter_map(|segment| match segment {
                Segment::Move(_, y) | Segment::Line(_, y) => Some(y),
                Segment::Quad(_, _, _, y) | Segment::Cubic(_, _, _, _, _, y) => Some(y),
                Segment::Close => None,
            })
            .fold((metrics.descender, metrics.ascender), |(low, high), y| {
                (low.min(y), high.max(y))
            });
        let cell_height = CELL_PAD + (top - bottom) * scale + CELL_NAME_HEIGHT;
        let available = self.page_width().unwrap_or(GRID_WIDTH) - self.origin_x - MARGIN;
        let columns = (((available + CELL_GAP) / (cell_width + CELL_GAP)).floor() as usize).max(1);

        for (line, chunk) in items.chunks(columns).enumerate() {
            let cell_top = self.cursor + line as f32 * (cell_height + CELL_GAP);
            let baseline = cell_top + CELL_PAD + top * scale;
            for (column, item) in chunk.iter().enumerate() {
                let x = self.origin_x + column as f32 * (cell_width + CELL_GAP);
                let (fill, dashed, name_color) = match item.glyph {
                    Some(_) => (Some(CELL), None, MUTED),
                    None => (None, Some(MISSING), MISSING),
                };
                self.marks.push(Mark::Rect {
                    x,
                    y: cell_top,
                    width: cell_width,
                    height: cell_height,
                    fill,
                    dashed,
                });
                if let Some(glyph) = item.glyph {
                    let run = shaping.glyph_run(&[glyph]);
                    // A glyph wider than its cell is drawn smaller rather than clipped.
                    let fit = if run.advance > 0.0 {
                        scale.min((cell_width - 2.0 * CELL_PAD) / run.advance)
                    } else {
                        scale
                    };
                    let glyph_x = x + (cell_width - run.advance * fit) / 2.0;
                    self.ink(&run.glyphs, glyph_x, baseline, fit, &item.name);
                }
                let style = TextStyle {
                    color: name_color,
                    ..CELL_NAME
                };
                let name = self.ui.fit(&item.name, style, cell_width - 8.0);
                let name_baseline = cell_top + cell_height - 7.0;
                self.text(
                    &name,
                    style,
                    x + cell_width / 2.0,
                    name_baseline,
                    Align::Center,
                );
                self.right = self.right.max(x + cell_width);
            }
            let ids: Vec<u32> = chunk.iter().filter_map(|item| item.glyph).collect();
            self.rows.push(Row {
                section: index,
                text: String::new(),
                size,
                baseline,
                run: shaping.glyph_run(&ids),
                location: shaping.location().to_vec(),
                missing_characters: Vec::new(),
            });
        }
        let lines = items.len().div_ceil(columns).max(1) as f32;
        self.cursor += lines * (cell_height + CELL_GAP) - CELL_GAP;
        Ok(())
    }

    fn finish(mut self, missing_glyphs: Vec<(usize, String)>, units_per_em: u16) -> ProofPage {
        let width = self
            .page_width()
            .unwrap_or((self.right + MARGIN).max(MIN_WIDTH))
            .ceil();
        for deferred in std::mem::take(&mut self.deferred) {
            match deferred {
                Deferred::RightText(text, style, baseline) => {
                    let mark = self
                        .ui
                        .mark(&text, style, width - MARGIN, baseline, Align::Right);
                    self.marks.push(Mark::Run(mark));
                }
                Deferred::Rule(y) => self.marks.push(Mark::Line {
                    class: "rule",
                    x0: MARGIN,
                    y0: y,
                    x1: width - MARGIN,
                    y1: y,
                    color: INK,
                }),
            }
        }
        ProofPage {
            width: width as u32,
            height: (self.cursor + MARGIN).ceil() as u32,
            marks: self.marks,
            rows: self.rows,
            missing_glyphs,
            units_per_em,
        }
    }
}

/// Each distinct vertical metric height in font units with its gutter
/// label, nearest the baseline first; metrics at the same height share one.
fn guide_labels(metrics: &VerticalMetrics) -> Vec<(f32, String)> {
    let mut named: Vec<(f32, &str)> = vec![(0.0, "baseline")];
    named.extend(metrics.x_height.map(|height| (height, "x-height")));
    named.extend(metrics.cap_height.map(|height| (height, "cap height")));
    named.push((metrics.ascender, "ascender"));
    named.push((metrics.descender, "descender"));
    named.sort_by(|a, b| a.0.abs().total_cmp(&b.0.abs()));

    let mut labels: Vec<(f32, Vec<&str>)> = Vec::new();
    for (height, name) in named {
        match labels.iter_mut().find(|(existing, _)| *existing == height) {
            Some((_, names)) => names.push(name),
            None => labels.push((height, vec![name])),
        }
    }
    labels
        .into_iter()
        .map(|(height, names)| {
            let names = names.join(" / ");
            let label = if height == 0.0 {
                names
            } else {
                format!("{names} {}", number(height))
            };
            (height, label)
        })
        .collect()
}

fn px(size: f32) -> String {
    format!("{} px", number(size))
}

/// `wght 400 · wdth 100`.
fn location_caption(location: &[(String, f32)]) -> String {
    location
        .iter()
        .map(|(tag, value)| format!("{tag} {}", number(*value)))
        .collect::<Vec<_>>()
        .join(" · ")
}

/// Formats a number without a fractional part when whole.
fn number(value: f32) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guide_labels_merge_equal_metrics_nearest_the_baseline_first() {
        let metrics = VerticalMetrics {
            units_per_em: 1000,
            ascender: 700.0,
            descender: -200.0,
            x_height: Some(500.0),
            cap_height: Some(700.0),
        };

        let labels: Vec<String> = guide_labels(&metrics)
            .into_iter()
            .map(|(_, label)| label)
            .collect();

        assert_eq!(
            labels,
            [
                "baseline",
                "descender -200",
                "x-height 500",
                "cap height / ascender 700",
            ]
        );
    }

    #[test]
    fn captions_name_locations_by_axis() {
        let location = vec![("wght".to_string(), 400.0), ("wdth".to_string(), 87.5)];
        assert_eq!(location_caption(&location), "wght 400 · wdth 87.5");
        assert_eq!(px(12.0), "12 px");
    }
}
