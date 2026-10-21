//! How a location's user coordinates become the normalized coordinates a
//! shaper takes.

use harfrust::NormalizedCoord;

/// How one axis's user coordinates normalize: linear between mapping
/// points, clamped outside them.
#[derive(Clone, Debug, PartialEq)]
pub struct AxisNormalization {
    /// `(user, normalized)` at each mapping point, user increasing; one
    /// point has normalized `0`, the axis default.
    points: Vec<(f64, f64)>,
}

impl AxisNormalization {
    /// Makes a normalization from `(user, normalized)` mapping points.
    ///
    /// Points are sorted by user coordinate; an empty list normalizes every
    /// value to the default.
    pub fn new(mut points: Vec<(f64, f64)>) -> Self {
        points.sort_by(|a, b| a.0.total_cmp(&b.0));
        Self { points }
    }

    /// Returns the mapping points, user increasing.
    pub fn points(&self) -> &[(f64, f64)] {
        &self.points
    }

    /// Normalizes a user coordinate; `None`, or a value that is not a
    /// number, is the axis default.
    pub fn normalize(&self, user: Option<f64>) -> NormalizedCoord {
        let normalized = match user.filter(|user| !user.is_nan()) {
            Some(user) => self.interpolate(user),
            None => 0.0,
        };
        #[expect(
            clippy::cast_possible_truncation,
            reason = "normalized coordinates lie in -1..=1 and become F2Dot14"
        )]
        let normalized = normalized as f32;
        NormalizedCoord::from_f32(normalized)
    }

    fn interpolate(&self, user: f64) -> f64 {
        let (Some(&(first_user, first)), Some(&(last_user, last))) =
            (self.points.first(), self.points.last())
        else {
            return 0.0;
        };
        if user <= first_user {
            return first;
        }
        if user >= last_user {
            return last;
        }
        self.points
            .windows(2)
            .find_map(|pair| {
                let [(lower_user, lower), (upper_user, upper)] = [pair[0], pair[1]];
                (user <= upper_user).then(|| {
                    let span = upper_user - lower_user;
                    if span == 0.0 {
                        upper
                    } else {
                        lower + (upper - lower) * (user - lower_user) / span
                    }
                })
            })
            .unwrap_or(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weight() -> AxisNormalization {
        // A weight axis from 100 to 900 with its default at 400 and a mapping
        // point that bends the upper half.
        AxisNormalization::new(vec![
            (100.0, -1.0),
            (400.0, 0.0),
            (700.0, 0.8),
            (900.0, 1.0),
        ])
    }

    fn normalize(axis: &AxisNormalization, user: Option<f64>) -> f32 {
        axis.normalize(user).to_f32()
    }

    #[test]
    fn interpolates_between_mapping_points() {
        assert_eq!(normalize(&weight(), Some(250.0)), -0.5);
        assert!((normalize(&weight(), Some(550.0)) - 0.4).abs() < 1e-4);
    }

    #[test]
    fn clamps_outside_the_axis() {
        assert_eq!(normalize(&weight(), Some(50.0)), -1.0);
        assert_eq!(normalize(&weight(), Some(1000.0)), 1.0);
    }

    #[test]
    fn a_missing_coordinate_is_the_default() {
        assert_eq!(normalize(&weight(), None), 0.0);
        assert_eq!(normalize(&weight(), Some(f64::NAN)), 0.0);
    }
}
