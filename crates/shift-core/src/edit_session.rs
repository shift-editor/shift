use crate::{snapshot::GlyphSnapshot, Contour, ContourId, GlyphLayer, PointId, PointType};

pub struct EditSession {
    layer: GlyphLayer,
    glyph_name: String,
    unicode: u32,
    active_contour_id: Option<ContourId>,
}

impl EditSession {
    pub fn new(name: String, unicode: u32, layer: GlyphLayer) -> Self {
        Self {
            layer,
            glyph_name: name,
            unicode,
            active_contour_id: None,
        }
    }

    pub fn layer(&self) -> &GlyphLayer {
        &self.layer
    }

    pub fn layer_mut(&mut self) -> &mut GlyphLayer {
        &mut self.layer
    }

    pub fn into_layer(self) -> GlyphLayer {
        self.layer
    }

    pub fn glyph_name(&self) -> &str {
        &self.glyph_name
    }

    pub fn unicode(&self) -> u32 {
        self.unicode
    }

    pub fn width(&self) -> f64 {
        self.layer.width()
    }

    pub fn active_contour_id(&self) -> Option<ContourId> {
        self.active_contour_id
    }

    pub fn set_active_contour(&mut self, contour_id: ContourId) {
        self.active_contour_id = Some(contour_id);
    }

    pub fn clear_active_contour(&mut self) {
        self.active_contour_id = None;
    }

    pub fn add_empty_contour(&mut self) -> ContourId {
        let contour = Contour::new();
        let contour_id = contour.id();
        self.layer.add_contour(contour);
        self.active_contour_id = Some(contour_id);
        contour_id
    }

    pub fn remove_contour(&mut self, contour_id: ContourId) -> Option<Contour> {
        if self.active_contour_id == Some(contour_id) {
            self.active_contour_id = None;
        }
        self.layer.remove_contour(contour_id)
    }

    fn contour_mut_or_err(&mut self, id: ContourId) -> Result<&mut Contour, String> {
        self.layer
            .contour_mut(id)
            .ok_or_else(|| format!("Contour {id:?} not found"))
    }

    pub fn add_point_to_contour(
        &mut self,
        contour_id: ContourId,
        x: f64,
        y: f64,
        point_type: PointType,
        is_smooth: bool,
    ) -> Result<PointId, String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        let point_id = contour.add_point(x, y, point_type, is_smooth);
        Ok(point_id)
    }

    pub fn add_point(
        &mut self,
        x: f64,
        y: f64,
        point_type: PointType,
        is_smooth: bool,
    ) -> Result<PointId, String> {
        let contour_id = match self.active_contour_id {
            Some(id) => id,
            None => self.add_empty_contour(),
        };
        self.add_point_to_contour(contour_id, x, y, point_type, is_smooth)
    }

    pub fn toggle_smooth(&mut self, point_id: PointId) -> Result<(), String> {
        let contour_id = self
            .find_point_contour(point_id)
            .ok_or_else(|| format!("Point {point_id:?} not found in any contour"))?;

        let contour = self.contour_mut_or_err(contour_id)?;
        let point = contour
            .get_point_mut(point_id)
            .ok_or_else(|| format!("Point {point_id:?} not found in contour"))?;

        point.toggle_smooth();
        Ok(())
    }

    pub fn insert_point_before(
        &mut self,
        before_id: PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        is_smooth: bool,
    ) -> Result<PointId, String> {
        let contour_id = self
            .find_point_contour(before_id)
            .ok_or_else(|| format!("Point {before_id:?} not found in any contour"))?;

        let contour = self.contour_mut_or_err(contour_id)?;
        contour
            .insert_point_before(before_id, x, y, point_type, is_smooth)
            .ok_or_else(|| format!("Failed to insert point before {before_id:?}"))
    }

    pub fn move_point(
        &mut self,
        contour_id: ContourId,
        point_id: PointId,
        x: f64,
        y: f64,
    ) -> Result<(), String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        let point = contour
            .get_point_mut(point_id)
            .ok_or_else(|| format!("Point {point_id:?} not found"))?;
        point.set_position(x, y);
        Ok(())
    }

    pub fn translate_point(
        &mut self,
        contour_id: ContourId,
        point_id: PointId,
        dx: f64,
        dy: f64,
    ) -> Result<(), String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        let point = contour
            .get_point_mut(point_id)
            .ok_or_else(|| format!("Point {point_id:?} not found"))?;
        point.translate(dx, dy);
        Ok(())
    }

    pub fn remove_point(&mut self, contour_id: ContourId, point_id: PointId) -> Result<(), String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour
            .remove_point(point_id)
            .ok_or_else(|| format!("Point {point_id:?} not found"))?;
        Ok(())
    }

    pub fn close_contour(&mut self, contour_id: ContourId) -> Result<(), String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour.close();
        Ok(())
    }

    pub fn open_contour(&mut self, contour_id: ContourId) -> Result<(), String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour.open();
        Ok(())
    }

    pub fn reverse_contour(&mut self, contour_id: ContourId) -> Result<(), String> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour.reverse();
        Ok(())
    }

    pub fn find_point_contour(&self, point_id: PointId) -> Option<ContourId> {
        for contour in self.layer.contours_iter() {
            if contour.get_point(point_id).is_some() {
                return Some(contour.id());
            }
        }
        None
    }

    pub fn move_points(&mut self, point_ids: &[PointId], dx: f64, dy: f64) -> Vec<PointId> {
        let mut moved_points = Vec::new();

        let point_contours: Vec<(PointId, ContourId)> = point_ids
            .iter()
            .filter_map(|&pid| self.find_point_contour(pid).map(|cid| (pid, cid)))
            .collect();

        for (point_id, contour_id) in point_contours {
            if let Some(contour) = self.layer.contour_mut(contour_id) {
                if let Some(point) = contour.get_point_mut(point_id) {
                    point.translate(dx, dy);
                    moved_points.push(point_id);
                }
            }
        }

        moved_points
    }

    /// Set absolute position for a single point
    pub fn set_point_position(&mut self, point_id: PointId, x: f64, y: f64) -> bool {
        let Some(contour_id) = self.find_point_contour(point_id) else {
            return false;
        };
        let Some(contour) = self.layer.contour_mut(contour_id) else {
            return false;
        };
        let Some(point) = contour.get_point_mut(point_id) else {
            return false;
        };
        point.set_position(x, y);
        true
    }

    pub fn remove_points(&mut self, point_ids: &[PointId]) -> Vec<PointId> {
        let mut removed_points = Vec::new();

        let point_contours: Vec<(PointId, ContourId)> = point_ids
            .iter()
            .filter_map(|&pid| self.find_point_contour(pid).map(|cid| (pid, cid)))
            .collect();

        for (point_id, contour_id) in point_contours {
            if let Some(contour) = self.layer.contour_mut(contour_id) {
                if contour.remove_point(point_id).is_some() {
                    removed_points.push(point_id);
                }
            }
        }

        removed_points
    }

    pub fn contour(&self, id: ContourId) -> Option<&Contour> {
        self.layer.contour(id)
    }

    pub fn contour_mut(&mut self, id: ContourId) -> Option<&mut Contour> {
        self.layer.contour_mut(id)
    }

    pub fn contours_iter(&self) -> impl Iterator<Item = &Contour> {
        self.layer.contours_iter()
    }

    pub fn contours_count(&self) -> usize {
        self.layer.contours().len()
    }

    pub fn paste_contours(
        &mut self,
        contours: Vec<PasteContour>,
        offset_x: f64,
        offset_y: f64,
    ) -> PasteResult {
        let mut created_point_ids = Vec::new();
        let mut created_contour_ids = Vec::new();

        for paste_contour in contours {
            let mut contour = Contour::new();

            for point in paste_contour.points {
                let point_id = contour.add_point(
                    point.x + offset_x,
                    point.y + offset_y,
                    point.point_type,
                    point.smooth,
                );
                created_point_ids.push(point_id);
            }

            if paste_contour.closed {
                contour.close();
            }

            let contour_id = self.layer.add_contour(contour);
            created_contour_ids.push(contour_id);
        }

        PasteResult {
            success: true,
            created_point_ids,
            created_contour_ids,
            error: None,
        }
    }

    pub fn restore_from_snapshot(&mut self, snapshot: &GlyphSnapshot) {
        self.layer.clear_contours();

        let active_contour_id = snapshot
            .active_contour_id
            .as_ref()
            .and_then(|id_str| id_str.parse::<ContourId>().ok());

        for contour_snapshot in &snapshot.contours {
            let contour_id = contour_snapshot.id.parse::<ContourId>().ok();

            let mut contour = match contour_id {
                Some(id) => Contour::with_id(id),
                None => Contour::new(),
            };

            for point_snapshot in &contour_snapshot.points {
                let point_type = match point_snapshot.point_type {
                    crate::snapshot::PointType::OnCurve => PointType::OnCurve,
                    crate::snapshot::PointType::OffCurve => PointType::OffCurve,
                };

                let point_id = point_snapshot.id.parse::<PointId>().ok();

                match point_id {
                    Some(id) => contour.add_point_with_id(
                        id,
                        point_snapshot.x,
                        point_snapshot.y,
                        point_type,
                        point_snapshot.smooth,
                    ),
                    None => {
                        contour.add_point(
                            point_snapshot.x,
                            point_snapshot.y,
                            point_type,
                            point_snapshot.smooth,
                        );
                    }
                }
            }

            if contour_snapshot.closed {
                contour.close();
            }

            self.layer.add_contour(contour);
        }

        self.active_contour_id = active_contour_id;
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PastePoint {
    pub x: f64,
    pub y: f64,
    pub point_type: PointType,
    pub smooth: bool,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteContour {
    pub points: Vec<PastePoint>,
    pub closed: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteResult {
    pub success: bool,
    pub created_point_ids: Vec<PointId>,
    pub created_contour_ids: Vec<ContourId>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_session() -> EditSession {
        EditSession::new("test".to_string(), 65, GlyphLayer::with_width(500.0))
    }

    #[test]
    fn new_session_has_no_active_contour() {
        let session = create_session();
        assert!(session.active_contour_id().is_none());
    }

    #[test]
    fn add_empty_contour_sets_active() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();

        assert_eq!(session.active_contour_id(), Some(contour_id));
        assert_eq!(session.contours_count(), 1);
    }

    #[test]
    fn remove_active_contour_clears_active() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();

        assert_eq!(session.active_contour_id(), Some(contour_id));

        session.remove_contour(contour_id);

        assert!(session.active_contour_id().is_none());
        assert_eq!(session.contours_count(), 0);
    }

    #[test]
    fn add_point_to_active_contour() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();

        let point_id = session
            .add_point(100.0, 200.0, PointType::OnCurve, false)
            .unwrap();

        let contour = session.contour(contour_id).unwrap();
        let point = contour.get_point(point_id).unwrap();

        assert_eq!(point.x(), 100.0);
        assert_eq!(point.y(), 200.0);
    }

    #[test]
    fn add_point_without_active_contour_creates_one() {
        let mut session = create_session();
        assert!(session.active_contour_id().is_none());

        let result = session.add_point(100.0, 200.0, PointType::OnCurve, false);

        assert!(result.is_ok());
        assert!(session.active_contour_id().is_some());
        assert_eq!(session.contours_count(), 1);

        let contour_id = session.active_contour_id().unwrap();
        let point_id = result.unwrap();
        let contour = session.contour(contour_id).unwrap();
        let point = contour.get_point(point_id).unwrap();
        assert_eq!(point.x(), 100.0);
        assert_eq!(point.y(), 200.0);
    }

    #[test]
    fn move_point() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();
        let point_id = session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();

        session
            .move_point(contour_id, point_id, 50.0, 75.0)
            .unwrap();

        let point = session
            .contour(contour_id)
            .unwrap()
            .get_point(point_id)
            .unwrap();

        assert_eq!(point.x(), 50.0);
        assert_eq!(point.y(), 75.0);
    }

    #[test]
    fn translate_point() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();
        let point_id = session
            .add_point(10.0, 20.0, PointType::OnCurve, false)
            .unwrap();

        session
            .translate_point(contour_id, point_id, 5.0, -10.0)
            .unwrap();

        let point = session
            .contour(contour_id)
            .unwrap()
            .get_point(point_id)
            .unwrap();

        assert_eq!(point.x(), 15.0);
        assert_eq!(point.y(), 10.0);
    }

    #[test]
    fn into_layer_transfers_ownership() {
        let mut session = create_session();
        session.add_empty_contour();

        let layer = session.into_layer();

        assert_eq!(layer.contours().len(), 1);
    }

    #[test]
    fn move_points_multiple() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();
        let p1 = session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();
        let p2 = session
            .add_point(100.0, 100.0, PointType::OnCurve, false)
            .unwrap();

        let moved = session.move_points(&[p1, p2], 10.0, 20.0);

        assert_eq!(moved.len(), 2);
        assert!(moved.contains(&p1));
        assert!(moved.contains(&p2));

        let contour = session.contour(contour_id).unwrap();
        assert_eq!(contour.get_point(p1).unwrap().x(), 10.0);
        assert_eq!(contour.get_point(p1).unwrap().y(), 20.0);
        assert_eq!(contour.get_point(p2).unwrap().x(), 110.0);
        assert_eq!(contour.get_point(p2).unwrap().y(), 120.0);
    }

    #[test]
    fn move_points_across_contours() {
        let mut session = create_session();
        let c1_id = session.add_empty_contour();
        let p1 = session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();

        let c2_id = session.add_empty_contour();
        let p2 = session
            .add_point(50.0, 50.0, PointType::OnCurve, false)
            .unwrap();

        let moved = session.move_points(&[p1, p2], 5.0, 5.0);

        assert_eq!(moved.len(), 2);

        let c1 = session.contour(c1_id).unwrap();
        let c2 = session.contour(c2_id).unwrap();

        assert_eq!(c1.get_point(p1).unwrap().x(), 5.0);
        assert_eq!(c2.get_point(p2).unwrap().x(), 55.0);
    }

    #[test]
    fn remove_points_multiple() {
        let mut session = create_session();
        session.add_empty_contour();
        let p1 = session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();
        let p2 = session
            .add_point(100.0, 100.0, PointType::OnCurve, false)
            .unwrap();
        let p3 = session
            .add_point(200.0, 200.0, PointType::OnCurve, false)
            .unwrap();

        let removed = session.remove_points(&[p1, p3]);

        assert_eq!(removed.len(), 2);
        assert!(removed.contains(&p1));
        assert!(removed.contains(&p3));

        assert!(session.find_point_contour(p2).is_some());
        assert!(session.find_point_contour(p1).is_none());
        assert!(session.find_point_contour(p3).is_none());
    }

    #[test]
    fn insert_point_before_creates_bezier_pattern() {
        let mut session = create_session();
        let contour_id = session.add_empty_contour();

        let anchor1 = session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();
        let anchor2 = session
            .add_point(100.0, 100.0, PointType::OnCurve, false)
            .unwrap();

        let control = session
            .insert_point_before(anchor2, 50.0, 75.0, PointType::OffCurve, false)
            .unwrap();

        let contour = session.contour(contour_id).unwrap();
        let points: Vec<_> = contour.points().iter().collect();

        assert_eq!(points.len(), 3);
        assert_eq!(points[0].id(), anchor1);
        assert_eq!(points[1].id(), control);
        assert_eq!(points[2].id(), anchor2);

        assert_eq!(points[0].point_type(), PointType::OnCurve);
        assert_eq!(points[1].point_type(), PointType::OffCurve);
        assert_eq!(points[2].point_type(), PointType::OnCurve);
    }

    #[test]
    fn insert_point_before_nonexistent_fails() {
        let mut session = create_session();
        session.add_empty_contour();
        session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();

        let fake_id = PointId::new();
        let result = session.insert_point_before(fake_id, 50.0, 50.0, PointType::OffCurve, false);

        assert!(result.is_err());
    }

    #[test]
    fn paste_point_deserializes_camel_case() {
        let json = r#"{"x":100,"y":200,"pointType":"onCurve","smooth":false}"#;
        let point: PastePoint = serde_json::from_str(json).unwrap();
        assert_eq!(point.x, 100.0);
        assert_eq!(point.y, 200.0);
        assert_eq!(point.point_type, PointType::OnCurve);
        assert!(!point.smooth);
    }

    #[test]
    fn paste_contour_deserializes_camel_case() {
        let json =
            r#"{"points":[{"x":10,"y":20,"pointType":"offCurve","smooth":true}],"closed":true}"#;
        let contour: PasteContour = serde_json::from_str(json).unwrap();
        assert_eq!(contour.points.len(), 1);
        assert_eq!(contour.points[0].point_type, PointType::OffCurve);
        assert!(contour.closed);
    }
}
