use crate::contour::{Contour, Contours};
use kurbo::BezPath;
use linesweeper::binary_op;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BooleanOp {
    Union,
    Subtract,
    Intersect,
    Difference,
}

pub fn boolean(op: BooleanOp, a: &Contour, b: &Contour) -> Result<Contours, linesweeper::Error> {
    let path_a = BezPath::from(a);
    let path_b = BezPath::from(b);

    let ls_op = match op {
        BooleanOp::Union => linesweeper::BinaryOp::Union,
        BooleanOp::Subtract => linesweeper::BinaryOp::Difference,
        BooleanOp::Intersect => linesweeper::BinaryOp::Intersection,
        BooleanOp::Difference => linesweeper::BinaryOp::Xor,
    };

    let out = binary_op(&path_a, &path_b, linesweeper::FillRule::EvenOdd, ls_op)?;

    let contours: Vec<Contour> = out
        .contours()
        .flat_map(|c| Contours::from(&c.path).0)
        .collect();

    Ok(Contours(contours))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::PointType;

    fn square(x: f64, y: f64, size: f64) -> Contour {
        let mut c = Contour::new();
        c.add_point(x, y, PointType::OnCurve, false);
        c.add_point(x + size, y, PointType::OnCurve, false);
        c.add_point(x + size, y + size, PointType::OnCurve, false);
        c.add_point(x, y + size, PointType::OnCurve, false);
        c.close();
        c
    }

    #[test]
    fn union_overlapping_squares() {
        let a = square(0.0, 0.0, 100.0);
        let b = square(50.0, 0.0, 100.0);

        let result = boolean(BooleanOp::Union, &a, &b).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_closed());
        assert!(result[0].len() > 4);
    }

    #[test]
    fn intersect_overlapping_squares() {
        let a = square(0.0, 0.0, 100.0);
        let b = square(50.0, 0.0, 100.0);

        let result = boolean(BooleanOp::Intersect, &a, &b).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_closed());
    }

    #[test]
    fn subtract_overlapping_squares() {
        let a = square(0.0, 0.0, 100.0);
        let b = square(50.0, 0.0, 100.0);

        let result = boolean(BooleanOp::Subtract, &a, &b).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].is_closed());
    }

    #[test]
    fn difference_overlapping_squares() {
        let a = square(0.0, 0.0, 100.0);
        let b = square(50.0, 0.0, 100.0);

        let result = boolean(BooleanOp::Difference, &a, &b).unwrap();
        // XOR of two overlapping squares produces two separate regions
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn union_non_overlapping_produces_two() {
        let a = square(0.0, 0.0, 50.0);
        let b = square(200.0, 200.0, 50.0);

        let result = boolean(BooleanOp::Union, &a, &b).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn intersect_non_overlapping_is_empty() {
        let a = square(0.0, 0.0, 50.0);
        let b = square(200.0, 200.0, 50.0);

        let result = boolean(BooleanOp::Intersect, &a, &b).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn union_identical_squares() {
        let a = square(0.0, 0.0, 100.0);
        let b = square(0.0, 0.0, 100.0);

        let result = boolean(BooleanOp::Union, &a, &b).unwrap();
        assert_eq!(result.len(), 1);
    }
}
