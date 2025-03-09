use serde::Serialize;

#[derive(Serialize)]
pub enum PointType {
    OnCurve,
    OffCurve,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContourPoint {
    point_type: PointType,
    x: f64,
    y: f64,
    smooth: bool,
}

impl ContourPoint {
    pub fn new(x: f64, y: f64, point_type: PointType, smooth: bool) -> Self {
        Self {
            x,
            y,
            point_type,
            smooth,
        }
    }
}

#[derive(Serialize)]
pub struct Contour {
    points: Vec<ContourPoint>,
    closed: bool,
}

impl Contour {
    pub fn new() -> Self {
        Self {
            points: Vec::new(),
            closed: false,
        }
    }

    pub fn add_point(&mut self, p: ContourPoint) {
        self.points.push(p);
    }

    pub fn is_closed(&self) {
        self.closed;
    }

    pub fn close(&mut self) {
        self.closed = true;
    }
}

#[cfg(test)]
mod tests {}
