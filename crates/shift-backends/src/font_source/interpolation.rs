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
    fn matches_typescript_axis_mapping_fixture() {
        let fixture =
            include_str!("../../../../packages/types/__fixtures__/axis_mapping_parity.txt");
        let mut points = Vec::new();
        let mut cases = Vec::new();
        for line in fixture.lines() {
            let mut fields = line.split(',');
            let kind = fields.next().unwrap();
            let input = fields.next().unwrap().parse::<f64>().unwrap();
            let output = fields.next().unwrap().parse::<f64>().unwrap();
            match kind {
                "point" => points.push((input, output)),
                "case" => cases.push((input, output)),
                _ => panic!("unknown axis mapping parity row {kind:?}"),
            }
        }

        for (input, expected) in cases {
            assert!((piecewise_map(input, &points) - expected).abs() < 1e-9);
        }
    }
}
