//! Piecewise-linear axis maps, as designspace `<map>` elements and Glyphs
//! axis mappings write them.

/// Maps `value` through `points`, `(input, output)` pairs sorted by input.
///
/// Between two points the map interpolates linearly; two points with the
/// same input step to the first one's output. Outside the points it keeps the
/// nearest point's offset, `value + output - input`, as designspace readers
/// extrapolate. No points maps every value to itself.
pub fn piecewise_map(value: f64, points: &[(f64, f64)]) -> f64 {
    let (Some(&(first_input, first_output)), Some(&(last_input, last_output))) =
        (points.first(), points.last())
    else {
        return value;
    };
    if value <= first_input {
        return value + first_output - first_input;
    }

    for pair in points.windows(2) {
        let [(left_input, left_output), (right_input, right_output)] = *pair else {
            unreachable!("a two-point window has two entries");
        };
        if value <= right_input {
            if left_input == right_input {
                return left_output;
            }

            return left_output
                + (right_output - left_output) * (value - left_input) / (right_input - left_input);
        }
    }

    value + last_output - last_input
}

#[cfg(test)]
mod tests {
    use super::piecewise_map;

    #[test]
    fn interpolates_between_points_and_keeps_the_offset_outside_them() {
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

    #[test]
    fn maps_every_value_to_itself_without_points() {
        assert_eq!(piecewise_map(42.0, &[]), 42.0);
    }

    #[test]
    fn a_repeated_input_takes_the_earlier_segments_output() {
        let points = [(0.0, 0.0), (100.0, 10.0), (100.0, 90.0), (200.0, 100.0)];

        assert_eq!(piecewise_map(100.0, &points), 10.0);
        assert_eq!(piecewise_map(150.0, &points), 95.0);
    }
}
