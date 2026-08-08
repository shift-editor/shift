pub(crate) fn piecewise_map(value: f64, points: &[(f64, f64)]) -> f64 {
    let Some(first) = points.first().copied() else {
        return value;
    };
    if value <= first.0 {
        return value + first.1 - first.0;
    }

    for pair in points.windows(2) {
        let [left, right] = pair else {
            unreachable!("a two-point window has two entries");
        };
        if value <= right.0 {
            if left.0 == right.0 {
                return left.1;
            }

            return left.1 + (right.1 - left.1) * (value - left.0) / (right.0 - left.0);
        }
    }

    let last = points.last().copied().expect("points are non-empty");
    value + last.1 - last.0
}

#[derive(Clone, Debug)]
pub(crate) struct InterpolationAxis {
    pub(crate) tag: String,
    pub(crate) minimum: f64,
    pub(crate) default: f64,
    pub(crate) maximum: f64,
}

#[cfg(test)]
mod tests {
    use super::piecewise_map;

    #[test]
    fn uses_designspace_offset_extrapolation() {
        let points = [(100.0, 80.0), (400.0, 400.0), (900.0, 850.0)];
        let cases = [
            (0.0, -20.0),
            (100.0, 80.0),
            (250.0, 240.0),
            (400.0, 400.0),
            (900.0, 850.0),
            (1000.0, 950.0),
        ];

        for (input, expected) in cases {
            assert!((piecewise_map(input, &points) - expected).abs() < 1e-9);
        }
    }
}
