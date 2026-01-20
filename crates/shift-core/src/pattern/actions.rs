use crate::{edit_session::EditSession, vec2::Vec2, PointId};

pub fn maintain_tangency(
    session: &mut EditSession,
    anchor_id: PointId,
    selected_id: PointId,
    opposite_id: PointId,
    _dx: f64,
    _dy: f64,
) -> Vec<PointId> {
    let Some(anchor_contour_id) = session.find_point_contour(anchor_id) else {
        return vec![];
    };

    let Some(contour) = session.contour(anchor_contour_id) else {
        return vec![];
    };

    let (anchor, selected, opposite) = {
        let a = contour.get_point(anchor_id);
        let s = contour.get_point(selected_id);
        let o = contour.get_point(opposite_id);

        match (a, s, o) {
            (Some(a), Some(s), Some(o)) => (Vec2::from(a), Vec2::from(s), Vec2::from(o)),
            _ => return vec![],
        }
    };

    let opposite_magnitude = (opposite - anchor).length();
    let selected_vec = selected - anchor;

    let new_opposite_pos = if selected_vec.length() < 1e-10 {
        opposite
    } else {
        let normalized = selected_vec.normalize();
        anchor + (-normalized * opposite_magnitude)
    };

    let Some(contour) = session.contour_mut(anchor_contour_id) else {
        return vec![];
    };

    if let Some(point) = contour.get_point_mut(opposite_id) {
        point.set_position(new_opposite_pos.x, new_opposite_pos.y);
        vec![opposite_id]
    } else {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{GlyphLayer, PointType};

    fn create_smooth_point_session() -> (EditSession, PointId, PointId, PointId) {
        let mut session = EditSession::new("test".to_string(), 65, GlyphLayer::with_width(500.0));
        session.add_empty_contour();

        let handle1 = session
            .add_point(0.0, 0.0, PointType::OffCurve, false)
            .unwrap();
        let smooth = session
            .add_point(50.0, 50.0, PointType::OnCurve, true)
            .unwrap();
        let handle2 = session
            .add_point(100.0, 100.0, PointType::OffCurve, false)
            .unwrap();

        (session, handle1, smooth, handle2)
    }

    #[test]
    fn maintain_tangency_rotates_opposite_handle() {
        let (mut session, handle1, smooth, handle2) = create_smooth_point_session();

        {
            let contour_id = session.active_contour_id().unwrap();
            let contour = session.contour_mut(contour_id).unwrap();
            let h2 = contour.get_point_mut(handle2).unwrap();
            h2.set_position(100.0, 50.0);
        }

        let affected = maintain_tangency(&mut session, smooth, handle2, handle1, 0.0, 0.0);

        assert_eq!(affected.len(), 1);
        assert!(affected.contains(&handle1));

        let contour_id = session.active_contour_id().unwrap();
        let contour = session.contour(contour_id).unwrap();
        let h1 = contour.get_point(handle1).unwrap();

        let smooth_pt = contour.get_point(smooth).unwrap();
        let h2_pt = contour.get_point(handle2).unwrap();

        let anchor = Vec2::from(smooth_pt);
        let vec_to_h1 = Vec2::from(h1) - anchor;
        let vec_to_h2 = Vec2::from(h2_pt) - anchor;

        assert!(
            vec_to_h1.dot(vec_to_h2) < 0.0,
            "Handles should point in opposite directions"
        );
    }

    #[test]
    fn maintain_tangency_preserves_opposite_handle_magnitude() {
        let (mut session, handle1, smooth, handle2) = create_smooth_point_session();

        let original_magnitude = {
            let contour_id = session.active_contour_id().unwrap();
            let contour = session.contour(contour_id).unwrap();
            let anchor = contour.get_point(smooth).unwrap();
            let h1 = contour.get_point(handle1).unwrap();
            let anchor_pos = Vec2::from(anchor);
            let h1_pos = Vec2::from(h1);
            (h1_pos - anchor_pos).length()
        };

        {
            let contour_id = session.active_contour_id().unwrap();
            let contour = session.contour_mut(contour_id).unwrap();
            let h2 = contour.get_point_mut(handle2).unwrap();
            h2.set_position(100.0, 50.0);
        }

        maintain_tangency(&mut session, smooth, handle2, handle1, 0.0, 0.0);

        let new_magnitude = {
            let contour_id = session.active_contour_id().unwrap();
            let contour = session.contour(contour_id).unwrap();
            let anchor = contour.get_point(smooth).unwrap();
            let h1 = contour.get_point(handle1).unwrap();
            let anchor_pos = Vec2::from(anchor);
            let h1_pos = Vec2::from(h1);
            (h1_pos - anchor_pos).length()
        };

        assert!(
            (new_magnitude - original_magnitude).abs() < 1e-10,
            "Magnitude should be preserved: original={original_magnitude}, new={new_magnitude}",
        );
    }
}
