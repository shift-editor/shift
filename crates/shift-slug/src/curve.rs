use crate::{CurveShape, OutlineCommand, QuadraticOutline, SlugError};

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

impl std::ops::Add for Point {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y)
    }
}

impl std::ops::Sub for Point {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y)
    }
}

impl std::ops::Mul<f32> for Point {
    type Output = Self;

    fn mul(self, scale: f32) -> Self {
        Self::new(self.x * scale, self.y * scale)
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

    /// Returns the bounds that enclose every curve, or empty bounds when
    /// there are none.
    pub(crate) fn of_curves<'a>(curves: impl IntoIterator<Item = &'a Curve>) -> Self {
        curves
            .into_iter()
            .map(|curve| curve.bounds())
            .reduce(Self::union)
            .unwrap_or_default()
    }

    fn union(self, other: Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
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

/// Curves add, subtract and scale point by point, as the variable atlas
/// blends source deltas.
impl std::ops::Add for Curve {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self {
            p0: self.p0 + other.p0,
            p1: self.p1 + other.p1,
            p2: self.p2 + other.p2,
        }
    }
}

impl std::ops::Sub for Curve {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self {
            p0: self.p0 - other.p0,
            p1: self.p1 - other.p1,
            p2: self.p2 - other.p2,
        }
    }
}

impl std::ops::Mul<f32> for Curve {
    type Output = Self;

    fn mul(self, scale: f32) -> Self {
        Self {
            p0: self.p0 * scale,
            p1: self.p1 * scale,
            p2: self.p2 * scale,
        }
    }
}

impl Curve {
    /// Returns whether every coordinate is zero, as in a delta that moves nothing.
    pub(crate) fn is_zero(self) -> bool {
        self == Self::default()
    }

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

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a small non-negative subdivision count; `as` saturates"
        )]
        let count = (error_squared / maximum_squared).powf(1.0 / 6.0).ceil() as usize;
        count.max(1)
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
    outline: QuadraticOutline,
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
    outline_from_commands(commands).map(QuadraticOutline::into_curves)
}

pub(crate) fn outline_from_commands(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
) -> Result<QuadraticOutline, SlugError> {
    Ok(convert_commands(commands, None)?.outline)
}

pub(crate) fn outline_from_commands_with_subdivisions(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
    cubic_subdivision_counts: &[usize],
) -> Result<QuadraticOutline, SlugError> {
    Ok(convert_commands(commands, Some(cubic_subdivision_counts))?.outline)
}

pub(crate) fn cubic_subdivision_counts_from_commands(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
) -> Result<Vec<usize>, SlugError> {
    Ok(convert_commands(commands, None)?.cubic_subdivision_counts)
}

fn convert_commands(
    commands: impl IntoIterator<Item = OutlineCommand<f32>>,
    prescribed_subdivisions: Option<&[usize]>,
) -> Result<CurveConversion, SlugError> {
    let mut outline = QuadraticOutline::default();
    let mut cubic_subdivisions = Vec::new();
    let mut contour = None;

    for (command_index, command) in commands.into_iter().enumerate() {
        ensure_finite(command, command_index)?;

        match command {
            OutlineCommand::Move { x, y } => {
                close_open_contour(&mut contour, &mut outline);
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
                push_line(&mut outline, contour.current, next);
                contour.current = next;
                contour.has_segment = true;
            }
            OutlineCommand::Quad { cx, cy, x, y } => {
                let contour = contour
                    .as_mut()
                    .ok_or(SlugError::DrawingCommandWithoutContour { command_index })?;
                let next = Point::new(x, y);
                outline.push(
                    Curve {
                        p0: contour.current,
                        p1: Point::new(cx, cy),
                        p2: next,
                    },
                    CurveShape::Quadratic,
                );
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
                outline.extend_quadratics(Curve::from_cubic_with_subdivisions(
                    contour.current,
                    first_control,
                    second_control,
                    next,
                    subdivision_count,
                ));
                cubic_subdivisions.push(subdivision_count);
                contour.current = next;
                contour.has_segment = true;
            }
            OutlineCommand::Close => {
                let active = contour.ok_or(SlugError::CloseWithoutContour { command_index })?;
                if !active.has_segment {
                    return Err(SlugError::CloseWithoutDrawingSegment { command_index });
                }
                push_line(&mut outline, active.current, active.start);
                contour = None;
            }
        }
    }

    close_open_contour(&mut contour, &mut outline);
    debug_assert!(
        prescribed_subdivisions.is_none_or(|counts| counts.len() == cubic_subdivisions.len())
    );
    Ok(CurveConversion {
        outline,
        cubic_subdivision_counts: cubic_subdivisions,
    })
}

fn close_open_contour(contour: &mut Option<Contour>, outline: &mut QuadraticOutline) {
    let Some(active) = contour.take() else {
        return;
    };
    if active.has_segment {
        push_line(outline, active.current, active.start);
    }
}

fn push_line(outline: &mut QuadraticOutline, start: Point, end: Point) {
    if start != end {
        outline.push(Curve::from_line(start, end), CurveShape::Line);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_of_curves_enclose_every_curve() {
        let curves = [
            Curve::from_line(Point::new(0.0, 0.0), Point::new(10.0, 5.0)),
            Curve::from_line(Point::new(-4.0, 2.0), Point::new(3.0, 20.0)),
        ];

        let bounds = Bounds::of_curves(&curves);

        assert_eq!((bounds.min_x, bounds.min_y), (-4.0, 0.0));
        assert_eq!((bounds.max_x, bounds.max_y), (10.0, 20.0));
        assert_eq!(Bounds::of_curves(&[]), Bounds::default());
    }

    #[test]
    fn curves_blend_point_by_point() {
        let base = Curve {
            p0: Point::new(1.0, 2.0),
            p1: Point::new(3.0, 4.0),
            p2: Point::new(5.0, 6.0),
        };
        let delta = base - base * 0.5;

        assert_eq!(base * 0.5 + delta, base);
        assert!((base - base).is_zero());
        assert!(!delta.is_zero());
    }
}
