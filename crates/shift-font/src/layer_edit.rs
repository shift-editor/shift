use crate::{
    boolean,
    error::{CoreError, CoreResult},
    Anchor, AnchorId, BooleanOp, Contour, ContourId, GlyphLayer, Point, PointId, PointType,
};
use std::collections::{HashMap, HashSet};

pub type GlyphValue = f64;

#[derive(Clone, Debug)]
pub struct AddedPoint {
    pub point_id: PointId,
    pub contour: Contour,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct NodePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BulkNodePositionUpdates<'a> {
    pub point_ids: Option<&'a [PointId]>,
    pub point_coords: Option<&'a [GlyphValue]>,
    pub anchor_ids: Option<&'a [AnchorId]>,
    pub anchor_coords: Option<&'a [GlyphValue]>,
}

#[derive(Default)]
struct NodePositionGroups {
    points: HashMap<PointId, NodePosition>,
    anchors: HashMap<AnchorId, NodePosition>,
}

struct BulkPositionUpdateReader {
    groups: NodePositionGroups,
}

impl BulkPositionUpdateReader {
    fn new() -> Self {
        Self {
            groups: NodePositionGroups::default(),
        }
    }

    fn read_points(
        &mut self,
        ids: Option<&[PointId]>,
        coords: Option<&[GlyphValue]>,
    ) -> CoreResult<()> {
        let Some(ids) = ids else {
            return Ok(());
        };

        let coords = coords.ok_or_else(|| {
            invalid_position_update_input("point positions", "missing coordinates")
        })?;
        let mut coords = BulkPositionCoords::new(coords, ids.len(), "point positions")?;

        for id in ids {
            let (x, y) = coords.next()?;
            self.groups.points.insert(id.clone(), NodePosition { x, y });
        }

        coords.finish()
    }

    fn read_anchors(
        &mut self,
        ids: Option<&[AnchorId]>,
        coords: Option<&[GlyphValue]>,
    ) -> CoreResult<()> {
        let Some(ids) = ids else {
            return Ok(());
        };

        let coords = coords.ok_or_else(|| {
            invalid_position_update_input("anchor positions", "missing coordinates")
        })?;
        let mut coords = BulkPositionCoords::new(coords, ids.len(), "anchor positions")?;

        for id in ids {
            let (x, y) = coords.next()?;
            self.groups
                .anchors
                .insert(id.clone(), NodePosition { x, y });
        }

        coords.finish()
    }

    fn finish(self) -> NodePositionGroups {
        self.groups
    }
}

struct BulkPositionCoords<'a> {
    coords: &'a [GlyphValue],
    index: usize,
    kind: &'static str,
}

impl<'a> BulkPositionCoords<'a> {
    fn new(coords: &'a [GlyphValue], id_count: usize, kind: &'static str) -> CoreResult<Self> {
        let expected_coords = id_count * 2;
        if coords.len() != expected_coords {
            return Err(invalid_position_update_input(
                kind,
                format!(
                    "expected {expected_coords} coordinates, got {}",
                    coords.len()
                ),
            ));
        }

        Ok(Self {
            coords,
            index: 0,
            kind,
        })
    }

    fn next(&mut self) -> CoreResult<(GlyphValue, GlyphValue)> {
        let x = self.read()?;
        let y = self.read()?;
        Ok((x, y))
    }

    fn finish(self) -> CoreResult<()> {
        if self.index == self.coords.len() {
            Ok(())
        } else {
            Err(invalid_position_update_input(
                self.kind,
                format!(
                    "expected {} coordinates, read {}",
                    self.coords.len(),
                    self.index
                ),
            ))
        }
    }

    fn read(&mut self) -> CoreResult<GlyphValue> {
        let index = self.index;
        let value = self.coords.get(index).copied().ok_or_else(|| {
            invalid_position_update_input(self.kind, format!("missing coordinate at index {index}"))
        })?;

        self.index += 1;
        Ok(value)
    }
}

fn invalid_position_update_input(kind: &'static str, message: impl Into<String>) -> CoreError {
    CoreError::InvalidPositionUpdateInput {
        kind,
        message: message.into(),
    }
}

impl GlyphLayer {
    fn contour_mut_or_err(&mut self, id: ContourId) -> CoreResult<&mut Contour> {
        let contour = self
            .contour_mut(id.clone())
            .ok_or(CoreError::ContourNotFound(id))?;

        Ok(contour)
    }

    fn point_mut_or_err(
        &mut self,
        contour_id: ContourId,
        point_id: PointId,
    ) -> CoreResult<&mut Point> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour
            .get_point_mut(point_id.clone())
            .ok_or(CoreError::PointNotFound(point_id))
    }

    fn point_contour_or_err(&self, point_id: PointId) -> CoreResult<ContourId> {
        self.find_point_contour(point_id.clone())
            .ok_or(CoreError::PointInContourNotFound(point_id))
    }

    fn anchor_mut_or_err(&mut self, anchor_id: AnchorId) -> CoreResult<&mut Anchor> {
        self.anchor_mut(anchor_id.clone())
            .ok_or(CoreError::AnchorNotFound(anchor_id))
    }

    fn point_contours_or_err(
        &self,
        point_ids: &[PointId],
    ) -> CoreResult<Vec<(PointId, ContourId)>> {
        point_ids
            .iter()
            .map(|point_id| {
                self.point_contour_or_err(point_id.clone())
                    .map(|contour_id| (point_id.clone(), contour_id))
            })
            .collect()
    }

    fn points_exist_or_err(&self, point_ids: &[PointId]) -> CoreResult<()> {
        for point_id in point_ids {
            self.point_contour_or_err(point_id.clone())?;
        }
        Ok(())
    }

    fn point_positions_exist_or_err(
        &self,
        updates: &HashMap<PointId, NodePosition>,
    ) -> CoreResult<()> {
        for point_id in updates.keys() {
            self.point_contour_or_err(point_id.clone())?;
        }
        Ok(())
    }

    fn anchor_positions_exist_or_err(
        &self,
        updates: &HashMap<AnchorId, NodePosition>,
    ) -> CoreResult<()> {
        for anchor_id in updates.keys() {
            if self.anchor(anchor_id.clone()).is_none() {
                return Err(CoreError::AnchorNotFound(anchor_id.clone()));
            }
        }
        Ok(())
    }

    fn update_points(
        &mut self,
        point_ids: &[PointId],
        mut update: impl FnMut(&mut Point),
    ) -> CoreResult<()> {
        self.points_exist_or_err(point_ids)?;

        let mut remaining: HashSet<PointId> = point_ids.iter().cloned().collect();
        if remaining.is_empty() {
            return Ok(());
        }

        for contour in self.contours_iter_mut() {
            for point in contour.points_mut() {
                if remaining.remove(&point.id()) {
                    update(point);
                }
            }
        }

        if let Some(point_id) = remaining.into_iter().next() {
            Err(CoreError::PointNotFound(point_id))
        } else {
            Ok(())
        }
    }

    fn set_point_positions_validated(
        &mut self,
        updates: &HashMap<PointId, NodePosition>,
    ) -> CoreResult<()> {
        let mut remaining: HashSet<PointId> = updates.keys().cloned().collect();
        if remaining.is_empty() {
            return Ok(());
        }

        for contour in self.contours_iter_mut() {
            for point in contour.points_mut() {
                let point_id = point.id();
                if let Some(position) = updates.get(&point_id) {
                    point.set_position(position.x, position.y);
                    remaining.remove(&point_id);
                    if remaining.is_empty() {
                        return Ok(());
                    }
                }
            }
        }

        if let Some(point_id) = remaining.into_iter().next() {
            Err(CoreError::PointNotFound(point_id))
        } else {
            Ok(())
        }
    }

    fn set_anchor_positions_validated(
        &mut self,
        updates: &HashMap<AnchorId, NodePosition>,
    ) -> CoreResult<()> {
        for (anchor_id, position) in updates {
            self.anchor_mut_or_err(anchor_id.clone())?
                .set_position(position.x, position.y);
        }
        Ok(())
    }

    fn bulk_node_position_updates(
        updates: BulkNodePositionUpdates<'_>,
    ) -> CoreResult<NodePositionGroups> {
        let mut reader = BulkPositionUpdateReader::new();
        reader.read_points(updates.point_ids, updates.point_coords)?;
        reader.read_anchors(updates.anchor_ids, updates.anchor_coords)?;
        Ok(reader.finish())
    }

    fn apply_node_position_groups(&mut self, groups: &NodePositionGroups) -> CoreResult<()> {
        self.point_positions_exist_or_err(&groups.points)?;
        self.anchor_positions_exist_or_err(&groups.anchors)?;

        self.set_point_positions_validated(&groups.points)?;
        self.set_anchor_positions_validated(&groups.anchors)
    }
}

impl GlyphLayer {
    pub fn set_x_advance(&mut self, width: f64) {
        self.set_width(width);
    }

    /// Translate all editable glyph geometry in the active layer.
    ///
    /// This moves contour points, anchors, and component transforms.
    /// Glyph advance width is intentionally left unchanged.
    pub fn translate_layer(&mut self, dx: f64, dy: f64) {
        for contour in self.contours_iter_mut() {
            for point in contour.points_mut() {
                point.translate(dx, dy);
            }
        }

        let anchor_ids: Vec<_> = self.anchors_iter().map(|anchor| anchor.id()).collect();
        self.move_anchors(&anchor_ids, dx, dy);

        let component_ids: Vec<_> = self.components().keys().cloned().collect();
        for component_id in component_ids {
            if let Some(mut component) = self.remove_component(component_id) {
                component.translate(dx, dy);
                self.add_component(component);
            }
        }
    }
}

impl GlyphLayer {
    pub fn add_empty_contour(&mut self) -> Contour {
        let contour = Contour::new();
        let created_contour = contour.clone();
        self.add_contour(contour);

        created_contour
    }

    pub fn remove_contour_checked(&mut self, contour_id: ContourId) -> CoreResult<Contour> {
        self.remove_contour(contour_id.clone())
            .ok_or(CoreError::ContourNotFound(contour_id))
    }

    pub fn close_contour(&mut self, contour_id: ContourId) -> CoreResult<()> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour.close();
        Ok(())
    }

    pub fn open_contour(&mut self, contour_id: ContourId) -> CoreResult<()> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour.open();
        Ok(())
    }

    pub fn reverse_contour(&mut self, contour_id: ContourId) -> CoreResult<()> {
        let contour = self.contour_mut_or_err(contour_id)?;
        contour.reverse();
        Ok(())
    }

    pub fn apply_boolean_op(
        &mut self,
        contour_id_a: ContourId,
        contour_id_b: ContourId,
        op: BooleanOp,
    ) -> CoreResult<Vec<ContourId>> {
        let a = self
            .contour(contour_id_a.clone())
            .ok_or(CoreError::ContourNotFound(contour_id_a.clone()))?
            .clone();
        let b = self
            .contour(contour_id_b.clone())
            .ok_or(CoreError::ContourNotFound(contour_id_b.clone()))?
            .clone();

        let result =
            boolean(op, &a, &b).map_err(|e| CoreError::BooleanOperationFailed(e.to_string()))?;

        self.remove_contour_checked(contour_id_a.clone())?;
        self.remove_contour_checked(contour_id_b.clone())?;

        let mut created_ids = Vec::new();
        for contour in result.0 {
            let contour_id = self.add_contour(contour);
            created_ids.push(contour_id);
        }

        Ok(created_ids)
    }

    pub fn find_point_contour(&self, point_id: PointId) -> Option<ContourId> {
        for contour in self.contours_iter() {
            if contour.get_point(point_id.clone()).is_some() {
                return Some(contour.id());
            }
        }
        None
    }
}

impl GlyphLayer {
    pub fn add_point_to_contour(
        &mut self,
        contour_id: ContourId,
        x: f64,
        y: f64,
        point_type: PointType,
        is_smooth: bool,
    ) -> CoreResult<AddedPoint> {
        let contour = self.contour_mut_or_err(contour_id.clone())?;
        let point_id = contour.add_point(x, y, point_type, is_smooth);

        Ok(AddedPoint {
            point_id,
            contour: contour.clone(),
        })
    }

    pub fn insert_point_before(
        &mut self,
        before_id: PointId,
        x: f64,
        y: f64,
        point_type: PointType,
        is_smooth: bool,
    ) -> CoreResult<AddedPoint> {
        let contour_id = self.point_contour_or_err(before_id.clone())?;
        let contour = self.contour_mut_or_err(contour_id)?;

        let point_id = contour
            .insert_point_before(before_id.clone(), x, y, point_type, is_smooth)
            .ok_or(CoreError::PointNotFound(before_id))?;

        Ok(AddedPoint {
            point_id,
            contour: contour.clone(),
        })
    }

    pub fn remove_point(&mut self, point_id: PointId) -> CoreResult<()> {
        let contour_id = self.point_contour_or_err(point_id.clone())?;
        let contour = self.contour_mut_or_err(contour_id)?;
        contour
            .remove_point(point_id.clone())
            .ok_or(CoreError::PointNotFound(point_id))?;
        Ok(())
    }

    pub fn move_points(&mut self, point_ids: &[PointId], dx: f64, dy: f64) -> CoreResult<()> {
        self.update_points(point_ids, |point| point.translate(dx, dy))
    }

    pub fn set_point_smooth(&mut self, point_id: PointId, smooth: bool) -> CoreResult<()> {
        let contour_id = self.point_contour_or_err(point_id.clone())?;
        self.point_mut_or_err(contour_id, point_id)?
            .set_smooth(smooth);
        Ok(())
    }

    pub fn contour_of_point(&self, point_id: PointId) -> CoreResult<ContourId> {
        self.point_contour_or_err(point_id)
    }

    pub fn has_point(&self, point_id: PointId) -> bool {
        self.point_contour_or_err(point_id).is_ok()
    }

    pub fn toggle_smooth(&mut self, point_id: PointId) -> CoreResult<bool> {
        let contour_id = self.point_contour_or_err(point_id.clone())?;
        let point = self.point_mut_or_err(contour_id, point_id)?;

        point.toggle_smooth();

        Ok(point.is_smooth())
    }

    pub fn remove_points(&mut self, point_ids: &[PointId]) -> CoreResult<()> {
        let point_contours = self.point_contours_or_err(point_ids)?;

        for (point_id, contour_id) in point_contours {
            let contour = self.contour_mut_or_err(contour_id)?;
            contour
                .remove_point(point_id.clone())
                .ok_or(CoreError::PointNotFound(point_id))?;
        }

        Ok(())
    }

    pub fn has_anchor(&self, anchor_id: AnchorId) -> bool {
        self.anchor(anchor_id).is_some()
    }

    pub fn remove_anchors(&mut self, anchor_ids: &[AnchorId]) -> CoreResult<()> {
        for anchor_id in anchor_ids {
            if !self.has_anchor(anchor_id.clone()) {
                return Err(CoreError::AnchorNotFound(anchor_id.clone()));
            }
        }

        for anchor_id in anchor_ids {
            self.remove_anchor(anchor_id.clone())
                .ok_or(CoreError::AnchorNotFound(anchor_id.clone()))?;
        }

        Ok(())
    }
}

impl GlyphLayer {
    pub fn apply_bulk_node_positions(
        &mut self,
        updates: BulkNodePositionUpdates<'_>,
    ) -> CoreResult<()> {
        let groups = Self::bulk_node_position_updates(updates)?;
        self.apply_node_position_groups(&groups)
    }
}

impl GlyphLayer {
    pub fn contours_count(&self) -> usize {
        self.contours().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Anchor, Component, GlyphId, LayerId, SourceId};

    fn create_session() -> GlyphLayer {
        GlyphLayer::with_width(LayerId::new(), SourceId::new(), 500.0)
    }

    fn session_with_contour() -> (GlyphLayer, ContourId) {
        let mut session = create_session();
        let contour_id = session.add_empty_contour().id();
        (session, contour_id)
    }

    fn add_point(session: &mut GlyphLayer, contour_id: ContourId, x: f64, y: f64) -> PointId {
        session
            .add_point_to_contour(contour_id, x, y, PointType::OnCurve, false)
            .unwrap()
            .point_id
    }

    fn add_anchor(session: &mut GlyphLayer, x: f64, y: f64) -> AnchorId {
        session.add_anchor(Anchor::new(Some("top".to_string()), x, y))
    }

    fn point_position(
        session: &GlyphLayer,
        contour_id: ContourId,
        point_id: PointId,
    ) -> (f64, f64) {
        let point = session
            .contour(contour_id)
            .unwrap()
            .get_point(point_id)
            .unwrap();
        (point.x(), point.y())
    }

    fn anchor_position(session: &GlyphLayer, anchor_id: AnchorId) -> (f64, f64) {
        let anchor = session.anchor(anchor_id).unwrap();
        (anchor.x(), anchor.y())
    }

    #[test]
    fn remove_contour_removes_contour() {
        let (mut session, contour_id) = session_with_contour();

        session.remove_contour_checked(contour_id).unwrap();

        assert_eq!(session.contours_count(), 0);
    }

    #[test]
    fn remove_contour_missing_returns_typed_error() {
        let mut session = create_session();
        let contour_id = ContourId::new();

        assert!(matches!(
            session.remove_contour_checked(contour_id.clone()),
            Err(CoreError::ContourNotFound(id)) if id == contour_id
        ));
    }

    #[test]
    fn apply_bulk_node_positions_sets_points_and_anchors() {
        let (mut session, contour_id) = session_with_contour();
        let point_id = add_point(&mut session, contour_id.clone(), 10.0, 20.0);
        let anchor_id = add_anchor(&mut session, 100.0, 200.0);
        let point_ids = [point_id.clone()];
        let point_coords = [300.0, 400.0];
        let anchor_ids = [anchor_id.clone()];
        let anchor_coords = [500.0, 600.0];

        session
            .apply_bulk_node_positions(BulkNodePositionUpdates {
                point_ids: Some(&point_ids),
                point_coords: Some(&point_coords),
                anchor_ids: Some(&anchor_ids),
                anchor_coords: Some(&anchor_coords),
            })
            .unwrap();

        assert_eq!(
            point_position(&session, contour_id.clone(), point_id.clone()),
            (300.0, 400.0)
        );
        assert_eq!(anchor_position(&session, anchor_id.clone()), (500.0, 600.0));
    }

    #[test]
    fn add_point_to_missing_contour_returns_typed_error() {
        let mut session = create_session();
        let contour_id = ContourId::new();

        assert!(matches!(
            session.add_point_to_contour(contour_id.clone(), 1.0, 2.0, PointType::OnCurve, false),
            Err(CoreError::ContourNotFound(id)) if id == contour_id
        ));
    }

    #[test]
    fn move_points_multiple() {
        let (mut session, contour_id) = session_with_contour();
        let p1 = add_point(&mut session, contour_id.clone(), 0.0, 0.0);
        let p2 = add_point(&mut session, contour_id.clone(), 100.0, 100.0);

        session
            .move_points(&[p1.clone(), p2.clone()], 10.0, 20.0)
            .unwrap();

        assert_eq!(
            point_position(&session, contour_id.clone(), p1.clone()),
            (10.0, 20.0)
        );
        assert_eq!(
            point_position(&session, contour_id.clone(), p2.clone()),
            (110.0, 120.0)
        );
    }

    #[test]
    fn move_points_across_contours() {
        let mut session = create_session();
        let c1_id = session.add_empty_contour().id();
        let p1 = session
            .add_point_to_contour(c1_id.clone(), 0.0, 0.0, PointType::OnCurve, false)
            .unwrap();
        let p1 = p1.point_id;

        let c2_id = session.add_empty_contour().id();
        let p2 = session
            .add_point_to_contour(c2_id.clone(), 50.0, 50.0, PointType::OnCurve, false)
            .unwrap();
        let p2 = p2.point_id;

        session
            .move_points(&[p1.clone(), p2.clone()], 5.0, 5.0)
            .unwrap();

        let c1 = session.contour(c1_id.clone()).unwrap();
        let c2 = session.contour(c2_id.clone()).unwrap();

        assert_eq!(c1.get_point(p1.clone()).unwrap().x(), 5.0);
        assert_eq!(c2.get_point(p2.clone()).unwrap().x(), 55.0);
    }

    #[test]
    fn move_points_missing_point_does_not_partially_move_existing_points() {
        let (mut session, contour_id) = session_with_contour();
        let point_id = add_point(&mut session, contour_id.clone(), 0.0, 0.0);
        let missing_id = PointId::new();

        let result = session.move_points(&[point_id.clone(), missing_id.clone()], 10.0, 20.0);

        assert!(matches!(
            result,
            Err(CoreError::PointInContourNotFound(id)) if id == missing_id
        ));
        assert_eq!(
            point_position(&session, contour_id.clone(), point_id.clone()),
            (0.0, 0.0)
        );
    }

    #[test]
    fn apply_bulk_node_positions_missing_anchor_does_not_move_points() {
        let (mut session, contour_id) = session_with_contour();
        let point_id = add_point(&mut session, contour_id.clone(), 10.0, 20.0);
        let missing_id = AnchorId::new();
        let point_ids = [point_id.clone()];
        let point_coords = [300.0, 400.0];
        let anchor_ids = [missing_id.clone()];
        let anchor_coords = [500.0, 600.0];

        let result = session.apply_bulk_node_positions(BulkNodePositionUpdates {
            point_ids: Some(&point_ids),
            point_coords: Some(&point_coords),
            anchor_ids: Some(&anchor_ids),
            anchor_coords: Some(&anchor_coords),
        });

        assert!(matches!(
            result,
            Err(CoreError::AnchorNotFound(id)) if id == missing_id
        ));
        assert_eq!(
            point_position(&session, contour_id.clone(), point_id.clone()),
            (10.0, 20.0)
        );
    }

    #[test]
    fn translate_layer_moves_points_and_anchors_without_changing_width() {
        let mut session = create_session();
        let original_width = session.width();
        let contour_id = session.add_empty_contour().id();
        let point_id = session
            .add_point_to_contour(contour_id.clone(), 10.0, 20.0, PointType::OnCurve, false)
            .unwrap();
        let point_id = point_id.point_id;
        let anchor_id = session.add_anchor(Anchor::new(Some("top".to_string()), 30.0, 40.0));

        session.translate_layer(5.0, -3.0);

        let point = session
            .contour(contour_id.clone())
            .unwrap()
            .get_point(point_id.clone())
            .unwrap();
        let anchor = session.anchor(anchor_id.clone()).unwrap();
        assert_eq!(point.x(), 15.0);
        assert_eq!(point.y(), 17.0);
        assert_eq!(anchor.x(), 35.0);
        assert_eq!(anchor.y(), 37.0);
        assert_eq!(session.width(), original_width);
    }

    #[test]
    fn translate_layer_moves_component_transforms() {
        let mut session = create_session();
        let component_id = session.add_component(Component::new(GlyphId::from_raw("base"), "base"));

        session.translate_layer(12.0, -7.0);

        let component = session.component(component_id.clone()).unwrap();
        let matrix = component.matrix();
        assert_eq!(matrix.dx, 12.0);
        assert_eq!(matrix.dy, -7.0);
    }

    #[test]
    fn remove_points_removes_all_requested_points() {
        let (mut session, contour_id) = session_with_contour();
        let p1 = add_point(&mut session, contour_id.clone(), 0.0, 0.0);
        let p2 = add_point(&mut session, contour_id.clone(), 100.0, 100.0);
        let p3 = add_point(&mut session, contour_id.clone(), 200.0, 200.0);

        session.remove_points(&[p1.clone(), p3.clone()]).unwrap();

        assert!(session.find_point_contour(p2.clone()).is_some());
        assert!(session.find_point_contour(p1.clone()).is_none());
        assert!(session.find_point_contour(p3.clone()).is_none());
    }

    #[test]
    fn remove_points_missing_point_does_not_partially_remove_existing_points() {
        let (mut session, contour_id) = session_with_contour();
        let point_id = add_point(&mut session, contour_id.clone(), 0.0, 0.0);
        let missing_id = PointId::new();

        let result = session.remove_points(&[point_id.clone(), missing_id.clone()]);

        assert!(matches!(
            result,
            Err(CoreError::PointInContourNotFound(id)) if id == missing_id
        ));
        assert!(session.find_point_contour(point_id.clone()).is_some());
    }

    #[test]
    fn insert_point_before_creates_bezier_pattern() {
        let (mut session, contour_id) = session_with_contour();
        let anchor1 = add_point(&mut session, contour_id.clone(), 0.0, 0.0);
        let anchor2 = add_point(&mut session, contour_id.clone(), 100.0, 100.0);

        let control = session
            .insert_point_before(anchor2.clone(), 50.0, 75.0, PointType::OffCurve, false)
            .unwrap();
        let control = control.point_id;

        let contour = session.contour(contour_id.clone()).unwrap();
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
        let (mut session, contour_id) = session_with_contour();
        add_point(&mut session, contour_id.clone(), 0.0, 0.0);
        let fake_id = PointId::new();

        assert!(matches!(
            session.insert_point_before(fake_id.clone(), 50.0, 50.0, PointType::OffCurve, false),
            Err(CoreError::PointInContourNotFound(id)) if id == fake_id
        ));
    }
}
