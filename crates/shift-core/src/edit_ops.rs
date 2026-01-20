use std::collections::HashSet;

use crate::{
    edit_session::EditSession,
    pattern::{maintain_tangency, MatchedRule, PatternMatcher, RuleId},
    snapshot::GlyphSnapshot,
    PointId, PointType,
};

#[derive(Debug, Clone)]
pub struct EditResult {
    pub affected_point_ids: Vec<PointId>,
    pub snapshot: GlyphSnapshot,
    pub matched_rules: Vec<MatchedRule>,
}

pub fn apply_edits(
    session: &mut EditSession,
    selected_ids: &HashSet<PointId>,
    dx: f64,
    dy: f64,
) -> EditResult {
    let mut all_affected: Vec<PointId> = Vec::new();

    let selected_vec: Vec<PointId> = selected_ids.iter().copied().collect();
    let moved = session.move_points(&selected_vec, dx, dy);
    all_affected.extend(&moved);

    let matcher = PatternMatcher::new();
    let mut matched_rules: Vec<MatchedRule> = Vec::new();

    for &point_id in selected_ids {
        if let Some(contour_id) = session.find_point_contour(point_id) {
            if let Some(contour) = session.contour(contour_id) {
                if let Some(rule) = matcher.match_rule(contour, point_id, selected_ids) {
                    matched_rules.push(rule);
                }
            }
        }
    }

    for rule in &matched_rules {
        if let Some(rule_affected) = apply_rule(session, rule, dx, dy) {
            all_affected.extend(rule_affected);
        }
    }

    let snapshot = GlyphSnapshot::from_edit_session(session);

    EditResult {
        affected_point_ids: all_affected,
        snapshot,
        matched_rules,
    }
}

fn apply_rule(
    session: &mut EditSession,
    rule: &MatchedRule,
    dx: f64,
    dy: f64,
) -> Option<Vec<PointId>> {
    let point_id: PointId = rule.point_id.parse().ok()?;

    match &rule.rule_id {
        RuleId::MoveRightHandle | RuleId::MoveLeftHandle | RuleId::MoveBothHandles => {
            Some(move_anchor_handles(session, point_id, dx, dy))
        }
        RuleId::MaintainTangencyRight | RuleId::MaintainTangencyLeft => {
            apply_maintain_tangency_rule(session, rule, point_id, dx, dy)
        }
    }
}

fn move_anchor_handles(
    session: &mut EditSession,
    anchor_id: PointId,
    dx: f64,
    dy: f64,
) -> Vec<PointId> {
    let Some(contour_id) = session.find_point_contour(anchor_id) else {
        return vec![];
    };

    let handles_to_move = {
        let Some(contour) = session.contour(contour_id) else {
            return vec![];
        };

        let points = contour.points();
        let Some(anchor_idx) = points.iter().position(|p| p.id() == anchor_id) else {
            return vec![];
        };

        let mut handles = Vec::new();
        if anchor_idx > 0 && points[anchor_idx - 1].point_type() == PointType::OffCurve {
            handles.push(points[anchor_idx - 1].id());
        }
        if anchor_idx + 1 < points.len()
            && points[anchor_idx + 1].point_type() == PointType::OffCurve
        {
            handles.push(points[anchor_idx + 1].id());
        }
        handles
    };

    session.move_points(&handles_to_move, dx, dy)
}

fn apply_maintain_tangency_rule(
    session: &mut EditSession,
    rule: &MatchedRule,
    moved_handle_id: PointId,
    dx: f64,
    dy: f64,
) -> Option<Vec<PointId>> {
    if rule.affected_point_ids.len() < 2 {
        return None;
    }

    let anchor_id: PointId = rule.affected_point_ids[0].parse().ok()?;
    let opposite_id: PointId = rule.affected_point_ids[1].parse().ok()?;

    Some(maintain_tangency(
        session,
        anchor_id,
        moved_handle_id,
        opposite_id,
        dx,
        dy,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GlyphLayer;

    fn create_smooth_bezier_session() -> (EditSession, PointId, PointId, PointId, PointId, PointId)
    {
        let mut session = EditSession::new("test".to_string(), 65, GlyphLayer::with_width(500.0));
        session.add_empty_contour();

        let corner = session
            .add_point(0.0, 0.0, PointType::OnCurve, false)
            .unwrap();
        let handle1 = session
            .add_point(50.0, 0.0, PointType::OffCurve, false)
            .unwrap();
        let smooth = session
            .add_point(100.0, 50.0, PointType::OnCurve, true)
            .unwrap();
        let handle2 = session
            .add_point(150.0, 100.0, PointType::OffCurve, false)
            .unwrap();
        let corner2 = session
            .add_point(200.0, 100.0, PointType::OnCurve, false)
            .unwrap();

        (session, corner, handle1, smooth, handle2, corner2)
    }

    #[test]
    fn apply_edits_moves_selected_point() {
        let (mut session, corner, _handle1, _smooth, _handle2, _corner2) =
            create_smooth_bezier_session();

        let mut selected = HashSet::new();
        selected.insert(corner);

        let result = apply_edits(&mut session, &selected, 10.0, 20.0);

        assert!(result.affected_point_ids.contains(&corner));

        let contour_id = session.active_contour_id().unwrap();
        let contour = session.contour(contour_id).unwrap();
        let point = contour.get_point(corner).unwrap();
        assert_eq!(point.x(), 10.0);
        assert_eq!(point.y(), 20.0);
    }

    #[test]
    fn apply_edits_moves_handles_with_anchor() {
        let (mut session, _corner, handle1, smooth, handle2, _corner2) =
            create_smooth_bezier_session();

        let mut selected = HashSet::new();
        selected.insert(smooth);

        let result = apply_edits(&mut session, &selected, 10.0, 10.0);

        assert!(result
            .matched_rules
            .iter()
            .any(|r| r.rule_id == RuleId::MoveBothHandles));
        assert!(result.affected_point_ids.contains(&handle1));
        assert!(result.affected_point_ids.contains(&handle2));
    }

    #[test]
    fn apply_edits_maintains_tangency() {
        let (mut session, _corner, handle1, smooth, handle2, _corner2) =
            create_smooth_bezier_session();

        let mut selected = HashSet::new();
        selected.insert(handle2);

        let result = apply_edits(&mut session, &selected, 10.0, 0.0);

        assert!(result
            .matched_rules
            .iter()
            .any(|r| r.rule_id == RuleId::MaintainTangencyRight));

        let contour_id = session.active_contour_id().unwrap();
        let contour = session.contour(contour_id).unwrap();

        let smooth_pt = contour.get_point(smooth).unwrap();
        let h1 = contour.get_point(handle1).unwrap();
        let h2 = contour.get_point(handle2).unwrap();

        use crate::vec2::Vec2;
        let anchor = Vec2::from(smooth_pt);
        let vec_to_h1 = Vec2::from(h1) - anchor;
        let vec_to_h2 = Vec2::from(h2) - anchor;

        assert!(
            vec_to_h1.dot(vec_to_h2) < 0.0,
            "Handles should point in opposite directions after tangency maintenance"
        );
    }

    #[test]
    fn apply_edits_returns_snapshot() {
        let (mut session, corner, _handle1, _smooth, _handle2, _corner2) =
            create_smooth_bezier_session();

        let mut selected = HashSet::new();
        selected.insert(corner);

        let result = apply_edits(&mut session, &selected, 5.0, 5.0);

        assert!(!result.snapshot.contours.is_empty());
        assert_eq!(result.snapshot.name, "test");
    }
}
