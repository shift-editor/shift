use std::collections::{HashMap, HashSet};

use crate::{Contour, Point, PointId, PointType};

use super::{
    parser::{TOKEN_CORNER, TOKEN_HANDLE, TOKEN_NO_POINT, TOKEN_SELECTED, TOKEN_SMOOTH},
    rules::{build_rule_table, MatchedRule, Rule, RuleId},
};

const WINDOW_SIZES: &[usize] = &[3, 5];

fn checked_offset_index(base: usize, offset: i32, max_len: usize) -> Option<usize> {
    let result = base as i32 + offset;
    if result >= 0 && (result as usize) < max_len {
        Some(result as usize)
    } else {
        None
    }
}

pub struct PatternMatcher {
    rule_table: HashMap<String, Rule>,
}

impl PatternMatcher {
    pub fn new() -> Self {
        Self {
            rule_table: build_rule_table(),
        }
    }

    fn point_pattern(
        point: Option<&Point>,
        selected_points: &HashSet<PointId>,
        is_central: bool,
    ) -> char {
        match point {
            None => TOKEN_NO_POINT,
            Some(p) => {
                if selected_points.contains(&p.id()) && !is_central {
                    TOKEN_SELECTED
                } else {
                    match p.point_type() {
                        PointType::OnCurve | PointType::QCurve => {
                            if p.is_smooth() {
                                TOKEN_SMOOTH
                            } else {
                                TOKEN_CORNER
                            }
                        }
                        PointType::OffCurve => TOKEN_HANDLE,
                    }
                }
            }
        }
    }

    fn get_point_at_offset(contour: &Contour, center_idx: usize, offset: i32) -> Option<&Point> {
        checked_offset_index(center_idx, offset, contour.len()).map(|idx| &contour.points()[idx])
    }

    fn build_pattern(
        contour: &Contour,
        point_index: usize,
        selected_points: &HashSet<PointId>,
        window_size: usize,
    ) -> String {
        assert!(window_size % 2 == 1, "Window size must be odd");

        let half_window = (window_size / 2) as i32;
        let mut pattern = String::with_capacity(window_size);

        for i in -half_window..=half_window {
            let target_point = Self::get_point_at_offset(contour, point_index, i);
            let is_central = i == 0;
            pattern.push(Self::point_pattern(
                target_point,
                selected_points,
                is_central,
            ));
        }

        pattern
    }

    pub fn find_point_index(contour: &Contour, point_id: PointId) -> Option<usize> {
        contour.points().iter().position(|p| p.id() == point_id)
    }

    pub fn match_rule(
        &self,
        contour: &Contour,
        point_id: PointId,
        selected_points: &HashSet<PointId>,
    ) -> Option<MatchedRule> {
        let point_index = Self::find_point_index(contour, point_id)?;

        for &window_size in WINDOW_SIZES {
            let pattern = Self::build_pattern(contour, point_index, selected_points, window_size);

            if let Some(rule) = self.rule_table.get(&pattern) {
                let affected_point_ids =
                    self.compute_affected_points(contour, point_index, &rule.id);
                return Some(MatchedRule {
                    point_id: point_id.to_string(),
                    rule_id: rule.id.clone(),
                    description: rule.description,
                    pattern,
                    affected_point_ids,
                });
            }
        }

        None
    }

    fn compute_affected_points(
        &self,
        contour: &Contour,
        point_index: usize,
        rule_id: &RuleId,
    ) -> Vec<String> {
        let points = contour.points();
        let mut affected = Vec::new();

        match rule_id {
            RuleId::MoveRightHandle => {
                if point_index + 1 < points.len() {
                    affected.push(points[point_index + 1].id().to_string());
                }
            }
            RuleId::MoveLeftHandle => {
                if point_index > 0 {
                    affected.push(points[point_index - 1].id().to_string());
                }
            }
            RuleId::MoveBothHandles => {
                if point_index > 0 {
                    affected.push(points[point_index - 1].id().to_string());
                }
                if point_index + 1 < points.len() {
                    affected.push(points[point_index + 1].id().to_string());
                }
            }
            RuleId::MaintainTangencyRight => {
                if point_index > 0 {
                    affected.push(points[point_index - 1].id().to_string());
                    if point_index > 1 {
                        affected.push(points[point_index - 2].id().to_string());
                    }
                }
            }
            RuleId::MaintainTangencyLeft => {
                if point_index + 1 < points.len() {
                    affected.push(points[point_index + 1].id().to_string());
                    if point_index + 2 < points.len() {
                        affected.push(points[point_index + 2].id().to_string());
                    }
                }
            }
        }

        affected
    }

    pub fn build_patterns(
        &self,
        contour: &Contour,
        point_id: PointId,
        selected_points: &HashSet<PointId>,
    ) -> Vec<String> {
        let Some(point_index) = Self::find_point_index(contour, point_id) else {
            return vec![];
        };

        WINDOW_SIZES
            .iter()
            .map(|&window_size| {
                Self::build_pattern(contour, point_index, selected_points, window_size)
            })
            .collect()
    }
}

impl Default for PatternMatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_smooth_bezier_contour() -> (Contour, PointId, PointId, PointId, PointId, PointId) {
        let mut contour = Contour::new();
        let corner = contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        let handle1 = contour.add_point(50.0, 0.0, PointType::OffCurve, false);
        let smooth = contour.add_point(100.0, 50.0, PointType::OnCurve, true);
        let handle2 = contour.add_point(150.0, 100.0, PointType::OffCurve, false);
        let corner2 = contour.add_point(200.0, 100.0, PointType::OnCurve, false);

        (contour, corner, handle1, smooth, handle2, corner2)
    }

    #[test]
    fn build_pattern_for_smooth_anchor() {
        let (contour, _corner, _handle1, smooth, _handle2, _corner2) =
            create_smooth_bezier_contour();

        let mut selected = HashSet::new();
        selected.insert(smooth);

        let matcher = PatternMatcher::new();
        let patterns = matcher.build_patterns(&contour, smooth, &selected);

        assert_eq!(patterns[0], "HSH");
    }

    #[test]
    fn build_pattern_for_handle_on_smooth() {
        let (contour, _corner, _handle1, _smooth, handle2, _corner2) =
            create_smooth_bezier_contour();

        let mut selected = HashSet::new();
        selected.insert(handle2);

        let matcher = PatternMatcher::new();
        let patterns = matcher.build_patterns(&contour, handle2, &selected);

        assert_eq!(patterns[0], "SHC");
    }

    #[test]
    fn build_pattern_with_selection() {
        let (contour, _corner, handle1, smooth, _handle2, _corner2) =
            create_smooth_bezier_contour();

        let mut selected = HashSet::new();
        selected.insert(smooth);
        selected.insert(handle1);

        let matcher = PatternMatcher::new();
        let patterns = matcher.build_patterns(&contour, smooth, &selected);

        assert_eq!(patterns[0], "@SH");
    }

    #[test]
    fn match_rule_for_smooth_anchor() {
        let (contour, _corner, _handle1, smooth, _handle2, _corner2) =
            create_smooth_bezier_contour();

        let mut selected = HashSet::new();
        selected.insert(smooth);

        let matcher = PatternMatcher::new();
        let matched = matcher.match_rule(&contour, smooth, &selected);

        assert!(matched.is_some());
        let rule = matched.unwrap();
        assert_eq!(rule.rule_id, RuleId::MoveBothHandles);
        assert_eq!(rule.affected_point_ids.len(), 2);
    }

    #[test]
    fn match_rule_for_handle_on_smooth_right_side() {
        let (contour, _corner, _handle1, _smooth, handle2, _corner2) =
            create_smooth_bezier_contour();

        let mut selected = HashSet::new();
        selected.insert(handle2);

        let matcher = PatternMatcher::new();
        let patterns = matcher.build_patterns(&contour, handle2, &selected);

        assert_eq!(patterns[0], "SHC");
        assert_eq!(patterns[1], "HSHCN");

        let matched = matcher.match_rule(&contour, handle2, &selected);
        assert!(matched.is_some());

        let rule = matched.unwrap();
        assert_eq!(rule.rule_id, RuleId::MaintainTangencyRight);
    }

    #[test]
    fn match_rule_for_corner_with_right_handle() {
        let (contour, corner, _handle1, _smooth, _handle2, _corner2) =
            create_smooth_bezier_contour();

        let mut selected = HashSet::new();
        selected.insert(corner);

        let matcher = PatternMatcher::new();
        let matched = matcher.match_rule(&contour, corner, &selected);

        assert!(matched.is_some());
        let rule = matched.unwrap();
        assert_eq!(rule.rule_id, RuleId::MoveRightHandle);
    }

    #[test]
    fn no_match_for_isolated_corner() {
        let mut contour = Contour::new();
        let corner1 = contour.add_point(0.0, 0.0, PointType::OnCurve, false);
        let _corner2 = contour.add_point(100.0, 0.0, PointType::OnCurve, false);

        let mut selected = HashSet::new();
        selected.insert(corner1);

        let matcher = PatternMatcher::new();
        let matched = matcher.match_rule(&contour, corner1, &selected);

        assert!(matched.is_none());
    }
}
