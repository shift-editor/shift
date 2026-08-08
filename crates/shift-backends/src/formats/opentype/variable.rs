use skrifa::raw::types::Point as RawPoint;

use crate::font_source::{AffineTransform, FontReadError};

pub(super) fn infer_tuple_deltas(
    points: &[RawPoint<i32>],
    contour_ends: &[u16],
    deltas: &mut [Option<(f64, f64)>],
) -> Result<(), FontReadError> {
    let mut start = 0;
    for end in contour_ends {
        let end = *end as usize;
        if end < start || end >= points.len() || end >= deltas.len() {
            return Err(FontReadError::InvalidProjection {
                details: "variation contour endpoints are invalid".into(),
            });
        }
        let references = (start..=end)
            .filter(|index| deltas[*index].is_some())
            .collect::<Vec<_>>();
        match references.as_slice() {
            [] => {}
            [reference] => {
                let delta = deltas[*reference].expect("reference has a delta");
                for value in &mut deltas[start..=end] {
                    *value = Some(delta);
                }
            }
            _ => {
                for position in 0..references.len() {
                    let first = references[position];
                    let second = references[(position + 1) % references.len()];
                    let mut index = if first == end { start } else { first + 1 };
                    while index != second {
                        let x = interpolate_delta_coordinate(
                            points[index].x,
                            points[first].x,
                            points[second].x,
                            deltas[first].expect("reference has a delta").0,
                            deltas[second].expect("reference has a delta").0,
                        );
                        let y = interpolate_delta_coordinate(
                            points[index].y,
                            points[first].y,
                            points[second].y,
                            deltas[first].expect("reference has a delta").1,
                            deltas[second].expect("reference has a delta").1,
                        );
                        deltas[index] = Some((x, y));
                        index = if index == end { start } else { index + 1 };
                    }
                }
            }
        }
        start = end + 1;
    }
    Ok(())
}

fn interpolate_delta_coordinate(
    point: i32,
    first: i32,
    second: i32,
    first_delta: f64,
    second_delta: f64,
) -> f64 {
    let (first, first_delta, second, second_delta) = if first <= second {
        (first, first_delta, second, second_delta)
    } else {
        (second, second_delta, first, first_delta)
    };
    if first == second {
        return if first_delta == second_delta {
            first_delta
        } else {
            0.0
        };
    }
    if point <= first {
        return first_delta;
    }
    if point >= second {
        return second_delta;
    }
    first_delta
        + (second_delta - first_delta) * f64::from(point - first) / f64::from(second - first)
}

pub(super) fn component_transform(
    component: &skrifa::raw::tables::glyf::Component,
) -> AffineTransform {
    AffineTransform {
        xx: f64::from(component.transform.xx.to_f32()),
        xy: f64::from(component.transform.yx.to_f32()),
        yx: f64::from(component.transform.xy.to_f32()),
        yy: f64::from(component.transform.yy.to_f32()),
        dx: 0.0,
        dy: 0.0,
    }
}

pub(super) fn approximate_hypot(a: f64, b: f64) -> f64 {
    let a = a.abs();
    let b = b.abs();
    if a > b {
        a + 0.375 * b
    } else {
        b + 0.375 * a
    }
}
