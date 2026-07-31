use crate::{OutlineCommand, SlugError};

/// Maximum font-space distance between a source cubic and its quadratic approximation.
pub const CUBIC_APPROXIMATION_ACCURACY: f32 = 1.0;

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

    /// Returns the equal-parameter subdivision count needed for the cubic error bound.
    pub fn cubic_subdivision_count(p0: Point, c1: Point, c2: Point, p3: Point) -> usize {
        // The maximum distance error is proportional to the constant third derivative and
        // decreases with the cube of the subdivision count. This is the same conservative
        // bound used by kurbo's `CubicBez::to_quads`.
        let first_x = 3.0 * c1.x - p0.x;
        let first_y = 3.0 * c1.y - p0.y;
        let second_x = 3.0 * c2.x - p3.x;
        let second_y = 3.0 * c2.y - p3.y;
        let delta_x = second_x - first_x;
        let delta_y = second_y - first_y;
        let error_squared = delta_x * delta_x + delta_y * delta_y;
        let maximum_squared = 432.0 * CUBIC_APPROXIMATION_ACCURACY * CUBIC_APPROXIMATION_ACCURACY;

        ((error_squared / maximum_squared).powf(1.0 / 6.0).ceil() as usize).max(1)
    }

    /// Deterministically approximates one cubic within [`CUBIC_APPROXIMATION_ACCURACY`].
    pub fn from_cubic(p0: Point, c1: Point, c2: Point, p3: Point) -> Vec<Self> {
        let subdivision_count = Self::cubic_subdivision_count(p0, c1, c2, p3);
        Self::from_cubic_with_subdivisions(p0, c1, c2, p3, subdivision_count)
    }

    /// Approximates one cubic with a fixed count shared by compatible variable sources.
    pub fn from_cubic_with_subdivisions(
        p0: Point,
        c1: Point,
        c2: Point,
        p3: Point,
        subdivision_count: usize,
    ) -> Vec<Self> {
        let subdivision_count = subdivision_count.max(1);
        let evaluate = |t: f32| {
            let inverse = 1.0 - t;
            let inverse_squared = inverse * inverse;
            let t_squared = t * t;
            Point::new(
                p0.x * inverse_squared * inverse
                    + 3.0 * c1.x * inverse_squared * t
                    + 3.0 * c2.x * inverse * t_squared
                    + p3.x * t_squared * t,
                p0.y * inverse_squared * inverse
                    + 3.0 * c1.y * inverse_squared * t
                    + 3.0 * c2.y * inverse * t_squared
                    + p3.y * t_squared * t,
            )
        };
        let derivative = |t: f32| {
            let inverse = 1.0 - t;
            Point::new(
                3.0 * (c1.x - p0.x) * inverse * inverse
                    + 6.0 * (c2.x - c1.x) * inverse * t
                    + 3.0 * (p3.x - c2.x) * t * t,
                3.0 * (c1.y - p0.y) * inverse * inverse
                    + 6.0 * (c2.y - c1.y) * inverse * t
                    + 3.0 * (p3.y - c2.y) * t * t,
            )
        };
        let parameter_step = 1.0 / subdivision_count as f32;
        let mut curves = Vec::with_capacity(subdivision_count);

        for index in 0..subdivision_count {
            let start_parameter = index as f32 * parameter_step;
            let end_parameter = (index + 1) as f32 * parameter_step;
            let start = if index == 0 {
                p0
            } else {
                evaluate(start_parameter)
            };
            let end = if index + 1 == subdivision_count {
                p3
            } else {
                evaluate(end_parameter)
            };
            let start_derivative = derivative(start_parameter);
            let end_derivative = derivative(end_parameter);
            let control = Point::new(
                (2.0 * start.x
                    + 2.0 * end.x
                    + parameter_step * (start_derivative.x - end_derivative.x))
                    * 0.25,
                (2.0 * start.y
                    + 2.0 * end.y
                    + parameter_step * (start_derivative.y - end_derivative.y))
                    * 0.25,
            );
            curves.push(Self {
                p0: start,
                p1: control,
                p2: end,
            });
        }

        curves
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

struct CurveConversion {
    curves: Vec<Curve>,
    line_flags: Vec<bool>,
    cubic_subdivision_counts: Vec<usize>,
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
    let conversion = curves_line_flags_and_subdivisions(commands, None)?;
    Ok((conversion.curves, conversion.line_flags))
}

pub(crate) fn curves_and_line_flags_from_commands_with_subdivisions(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
    cubic_subdivision_counts: &[usize],
) -> Result<(Vec<Curve>, Vec<bool>), SlugError> {
    let conversion = curves_line_flags_and_subdivisions(commands, Some(cubic_subdivision_counts))?;
    Ok((conversion.curves, conversion.line_flags))
}

pub(crate) fn cubic_subdivision_counts_from_commands(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
) -> Result<Vec<usize>, SlugError> {
    let conversion = curves_line_flags_and_subdivisions(commands, None)?;
    Ok(conversion.cubic_subdivision_counts)
}

fn curves_line_flags_and_subdivisions(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
    prescribed_subdivisions: Option<&[usize]>,
) -> Result<CurveConversion, SlugError> {
    let mut curves = Vec::new();
    let mut line_flags = Vec::new();
    let mut cubic_subdivisions = Vec::new();
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
                let first_control = Point::new(c1x, c1y);
                let second_control = Point::new(c2x, c2y);
                let subdivision_count = prescribed_subdivisions
                    .and_then(|counts| counts.get(cubic_subdivisions.len()))
                    .copied()
                    .unwrap_or_else(|| {
                        Curve::cubic_subdivision_count(
                            contour.current,
                            first_control,
                            second_control,
                            next,
                        )
                    });
                let cubic_curves = Curve::from_cubic_with_subdivisions(
                    contour.current,
                    first_control,
                    second_control,
                    next,
                    subdivision_count,
                );
                line_flags.extend(std::iter::repeat_n(false, cubic_curves.len()));
                curves.extend(cubic_curves);
                cubic_subdivisions.push(subdivision_count);
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
    debug_assert!(
        prescribed_subdivisions.is_none_or(|counts| counts.len() == cubic_subdivisions.len())
    );
    Ok(CurveConversion {
        curves,
        line_flags,
        cubic_subdivision_counts: cubic_subdivisions,
    })
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
