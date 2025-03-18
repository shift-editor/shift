use serde::Serialize;
use ts_rs::TS;

#[derive(Serialize, Clone, TS)]
#[ts(export)]

pub enum PointType {
    OnCurve,
    OffCurve,
}

#[derive(Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
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

#[derive(Serialize, Clone, TS)]
#[ts(export)]
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

    pub fn to_svg(&self) -> String {
        let mut svg = String::new();
        svg.push_str("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1000 1000\">");
        svg.push_str("<path d=\"");
        svg.push_str("\" />");
        svg.push_str("</svg>");

        svg
    }
}

#[cfg(test)]
mod tests {}
