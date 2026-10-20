//! A glyph's outline as Slug quadratics, each paired with how it was authored.

use crate::{Curve, SlugError};

/// How a Slug quadratic was authored.
///
/// Slug stores every segment as a quadratic. A line's control point is not
/// stored independently: the shader regenerates it from the interpolated
/// endpoints, so the line stays straight at every location.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurveShape {
    /// Authored as a straight line; its control point is derived from its endpoints.
    Line,
    /// Authored as a quadratic or produced by approximating a cubic; its control point is stored.
    Quadratic,
}

/// A glyph's outline as Slug quadratics, each with its [`CurveShape`].
///
/// The curves and shapes always have the same length.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QuadraticOutline {
    curves: Vec<Curve>,
    shapes: Vec<CurveShape>,
}

impl QuadraticOutline {
    /// Pairs `curves` with `shapes`, one shape per curve.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::CurveShapeCountMismatch`] when the counts differ.
    pub fn new(curves: Vec<Curve>, shapes: Vec<CurveShape>) -> Result<Self, SlugError> {
        if curves.len() != shapes.len() {
            return Err(SlugError::CurveShapeCountMismatch {
                curves: curves.len(),
                shapes: shapes.len(),
            });
        }
        Ok(Self { curves, shapes })
    }

    /// An outline whose curves are all [`CurveShape::Quadratic`].
    pub fn from_quadratics(curves: impl IntoIterator<Item = Curve>) -> Self {
        let curves = curves.into_iter().collect::<Vec<_>>();
        let shapes = vec![CurveShape::Quadratic; curves.len()];
        Self { curves, shapes }
    }

    /// Appends one curve with its shape.
    pub fn push(&mut self, curve: Curve, shape: CurveShape) {
        self.curves.push(curve);
        self.shapes.push(shape);
    }

    /// Appends curves that are all [`CurveShape::Quadratic`].
    pub fn extend_quadratics(&mut self, curves: impl IntoIterator<Item = Curve>) {
        self.curves.extend(curves);
        self.shapes.resize(self.curves.len(), CurveShape::Quadratic);
    }

    pub fn curves(&self) -> &[Curve] {
        &self.curves
    }

    pub fn shapes(&self) -> &[CurveShape] {
        &self.shapes
    }

    pub fn len(&self) -> usize {
        self.curves.len()
    }

    pub fn is_empty(&self) -> bool {
        self.curves.is_empty()
    }

    /// Whether any curve was authored as a line.
    pub fn has_lines(&self) -> bool {
        self.shapes.contains(&CurveShape::Line)
    }

    /// Returns the curves, dropping their shapes.
    pub fn into_curves(self) -> Vec<Curve> {
        self.curves
    }

    /// Sets the line bit of each line curve, numbering curves from `curve_start`.
    ///
    /// `words` holds one bit per atlas curve, 32 per word, and grows to cover
    /// this outline.
    pub(crate) fn write_line_bits(&self, words: &mut Vec<u32>, curve_start: usize) {
        words.resize((curve_start + self.len()).div_ceil(32), 0);
        for (local_index, shape) in self.shapes.iter().enumerate() {
            if *shape == CurveShape::Line {
                let curve_index = curve_start + local_index;
                words[curve_index / 32] |= 1 << (curve_index % 32);
            }
        }
    }
}

impl FromIterator<(Curve, CurveShape)> for QuadraticOutline {
    fn from_iter<I: IntoIterator<Item = (Curve, CurveShape)>>(iter: I) -> Self {
        let (curves, shapes) = iter.into_iter().unzip();
        Self { curves, shapes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Point;

    fn curve(x: f32) -> Curve {
        Curve::from_line(Point::new(x, 0.0), Point::new(x + 1.0, 0.0))
    }

    #[test]
    fn new_rejects_a_shape_count_that_differs_from_the_curves() {
        let result = QuadraticOutline::new(vec![curve(0.0)], Vec::new());

        assert!(matches!(
            result,
            Err(SlugError::CurveShapeCountMismatch {
                curves: 1,
                shapes: 0
            })
        ));
    }

    #[test]
    fn line_bits_number_curves_from_the_atlas_start() {
        let outline = QuadraticOutline::from_iter([
            (curve(0.0), CurveShape::Line),
            (curve(1.0), CurveShape::Quadratic),
            (curve(2.0), CurveShape::Line),
        ]);
        let mut words = vec![0b1];

        outline.write_line_bits(&mut words, 31);

        assert_eq!(words, [0b1 | 1 << 31, 0b10]);
    }

    #[test]
    fn extending_with_quadratics_keeps_one_shape_per_curve() {
        let mut outline = QuadraticOutline::default();
        outline.push(curve(0.0), CurveShape::Line);
        outline.extend_quadratics([curve(1.0), curve(2.0)]);

        assert_eq!(
            outline.shapes(),
            [
                CurveShape::Line,
                CurveShape::Quadratic,
                CurveShape::Quadratic
            ]
        );
        assert!(outline.has_lines());
    }
}
