use shift_glyph_codec::OutlineCommand;

use crate::SlugError;

/// Imperceptible perpendicular displacement used for non-axis-aligned lines.
pub const LINE_EPSILON: f32 = 0.125;

/// One font-space position in the GPU curve representation.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

/// Conservative font-space bounds.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Bounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

impl Bounds {
    pub fn width(self) -> f32 {
        self.max_x - self.min_x
    }

    pub fn height(self) -> f32 {
        self.max_y - self.min_y
    }

    fn from_point(point: Point) -> Self {
        Self {
            min_x: point.x,
            min_y: point.y,
            max_x: point.x,
            max_y: point.y,
        }
    }

    fn include(&mut self, point: Point) {
        self.min_x = self.min_x.min(point.x);
        self.min_y = self.min_y.min(point.y);
        self.max_x = self.max_x.max(point.x);
        self.max_y = self.max_y.max(point.y);
    }
}

/// One quadratic Bézier consumed by the Slug coverage shader.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Curve {
    pub p0: Point,
    pub p1: Point,
    pub p2: Point,
}

impl Curve {
    pub fn from_line(p0: Point, p2: Point) -> Self {
        let delta_x = p2.x - p0.x;
        let delta_y = p2.y - p0.y;
        let mut p1 = Point::new((p0.x + p2.x) * 0.5, (p0.y + p2.y) * 0.5);

        if delta_x.abs() > 0.1 && delta_y.abs() > 0.1 {
            let length = delta_x.hypot(delta_y);
            if length > 0.0 {
                let scale = LINE_EPSILON / length;
                p1.x -= delta_y * scale;
                p1.y += delta_x * scale;
            }
        }

        Self { p0, p1, p2 }
    }

    /// Deterministically approximates one cubic with two quadratics.
    pub fn from_cubic(p0: Point, c1: Point, c2: Point, p3: Point) -> [Self; 2] {
        let midpoint = |left: Point, right: Point| {
            Point::new((left.x + right.x) * 0.5, (left.y + right.y) * 0.5)
        };
        let m01 = midpoint(p0, c1);
        let m12 = midpoint(c1, c2);
        let m23 = midpoint(c2, p3);
        let m012 = midpoint(m01, m12);
        let m123 = midpoint(m12, m23);
        let middle = midpoint(m012, m123);

        [
            Self {
                p0,
                p1: m01,
                p2: middle,
            },
            Self {
                p0: middle,
                p1: m123,
                p2: p3,
            },
        ]
    }

    pub fn bounds(self) -> Bounds {
        let mut bounds = Bounds::from_point(self.p0);
        bounds.include(self.p1);
        bounds.include(self.p2);
        bounds
    }

    pub fn max_x(self) -> f32 {
        self.p0.x.max(self.p1.x).max(self.p2.x)
    }

    pub fn max_y(self) -> f32 {
        self.p0.y.max(self.p1.y).max(self.p2.y)
    }
}

#[derive(Clone, Copy)]
struct Contour {
    start: Point,
    current: Point,
    has_segment: bool,
}

pub(crate) fn curves_from_commands(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
) -> Result<Vec<Curve>, SlugError> {
    curves_and_line_flags_from_commands(commands).map(|(curves, _)| curves)
}

pub(crate) fn curves_and_line_flags_from_commands(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
) -> Result<(Vec<Curve>, Vec<bool>), SlugError> {
    let mut curves = Vec::new();
    let mut line_flags = Vec::new();
    let mut contour = None;

    for (command_index, command) in commands.into_iter().enumerate() {
        ensure_finite(command, command_index)?;

        match command {
            OutlineCommand::Move { x, y } => {
                close_open_contour(&mut contour, &mut curves, &mut line_flags);
                let point = Point::new(x, y);
                contour = Some(Contour {
                    start: point,
                    current: point,
                    has_segment: false,
                });
            }
            OutlineCommand::Line { x, y } => {
                let contour = contour
                    .as_mut()
                    .ok_or(SlugError::DrawingCommandWithoutContour { command_index })?;
                let next = Point::new(x, y);
                push_line(&mut curves, &mut line_flags, contour.current, next);
                contour.current = next;
                contour.has_segment = true;
            }
            OutlineCommand::Quad { cx, cy, x, y } => {
                let contour = contour
                    .as_mut()
                    .ok_or(SlugError::DrawingCommandWithoutContour { command_index })?;
                let next = Point::new(x, y);
                curves.push(Curve {
                    p0: contour.current,
                    p1: Point::new(cx, cy),
                    p2: next,
                });
                line_flags.push(false);
                contour.current = next;
                contour.has_segment = true;
            }
            OutlineCommand::Cubic {
                c1x,
                c1y,
                c2x,
                c2y,
                x,
                y,
            } => {
                let contour = contour
                    .as_mut()
                    .ok_or(SlugError::DrawingCommandWithoutContour { command_index })?;
                let next = Point::new(x, y);
                curves.extend(Curve::from_cubic(
                    contour.current,
                    Point::new(c1x, c1y),
                    Point::new(c2x, c2y),
                    next,
                ));
                line_flags.extend([false, false]);
                contour.current = next;
                contour.has_segment = true;
            }
            OutlineCommand::Close => {
                let active = contour.ok_or(SlugError::CloseWithoutContour { command_index })?;
                if !active.has_segment {
                    return Err(SlugError::CloseWithoutDrawingSegment { command_index });
                }
                push_line(&mut curves, &mut line_flags, active.current, active.start);
                contour = None;
            }
        }
    }

    close_open_contour(&mut contour, &mut curves, &mut line_flags);
    debug_assert_eq!(curves.len(), line_flags.len());
    Ok((curves, line_flags))
}

fn close_open_contour(
    contour: &mut Option<Contour>,
    curves: &mut Vec<Curve>,
    line_flags: &mut Vec<bool>,
) {
    let Some(active) = contour.take() else {
        return;
    };
    if active.has_segment {
        push_line(curves, line_flags, active.current, active.start);
    }
}

fn push_line(curves: &mut Vec<Curve>, line_flags: &mut Vec<bool>, start: Point, end: Point) {
    if start != end {
        curves.push(Curve::from_line(start, end));
        line_flags.push(true);
    }
}

fn ensure_finite(command: OutlineCommand<f32>, command_index: usize) -> Result<(), SlugError> {
    let finite = match command {
        OutlineCommand::Move { x, y } | OutlineCommand::Line { x, y } => {
            Point::new(x, y).is_finite()
        }
        OutlineCommand::Quad { cx, cy, x, y } => {
            Point::new(cx, cy).is_finite() && Point::new(x, y).is_finite()
        }
        OutlineCommand::Cubic {
            c1x,
            c1y,
            c2x,
            c2y,
            x,
            y,
        } => {
            Point::new(c1x, c1y).is_finite()
                && Point::new(c2x, c2y).is_finite()
                && Point::new(x, y).is_finite()
        }
        OutlineCommand::Close => true,
    };

    if finite {
        Ok(())
    } else {
        Err(SlugError::NonFiniteCoordinate { command_index })
    }
}
