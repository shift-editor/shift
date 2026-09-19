//! Structural matches between ordered authored glyph layers.

use std::collections::HashMap;

use crate::{AnchorId, ComponentId, ContourId, GlyphId, GlyphLayer, LayerId, PointId, PointType};

/// One structural difference that prevents two glyph layers from sharing values.
///
/// Contours, points, anchors, and components are compared in authored order.
/// This follows the positional matching required by outline interpolation and
/// by OpenType `gvar`, where composite variation indices address components in
/// glyph order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LayerDifference {
    /// The layers contain different numbers of contours.
    ContourCount { reference: usize, source: usize },
    /// The contour at the given position is open in one layer and closed in the other.
    ContourClosed {
        contour: usize,
        reference: bool,
        source: bool,
    },
    /// Corresponding contours contain different numbers of points.
    PointCount {
        contour: usize,
        reference: usize,
        source: usize,
    },
    /// Corresponding points have different authored point types.
    PointType {
        contour: usize,
        point: usize,
        reference: PointType,
        source: PointType,
    },
    /// The layers contain different numbers of anchors.
    ///
    /// This is a Shift interpolation constraint, not an OpenType `gvar`
    /// compatibility rule. Shift currently stores anchor positions in the
    /// layer's ordered interpolation values.
    AnchorCount { reference: usize, source: usize },
    /// Corresponding anchors have different names or authored order.
    ///
    /// This is a Shift interpolation constraint, not an OpenType `gvar`
    /// compatibility rule.
    AnchorSequence {
        reference: Vec<Option<String>>,
        source: Vec<Option<String>>,
    },
    /// Component glyph identities differ by count, identity, or authored order.
    ComponentSequence {
        reference: Vec<GlyphId>,
        source: Vec<GlyphId>,
    },
}

/// Derived structural match from one reference layer to one target layer.
///
/// A complete match means that both layers can share Shift's canonical
/// structure-ordered interpolation values. Complete matches also map each
/// reference contour, point, anchor, and component identity to its target
/// identity. Incomplete matches retain diagnostic differences but expose no
/// entity mappings, so callers cannot accidentally apply a partial edit.
///
/// Coordinates, advance width, smooth flags, anchor positions, and component
/// transforms are values rather than structural matching constraints.
#[derive(Clone, Debug, Eq, PartialEq)]
#[must_use]
pub struct LayerMatch {
    reference_layer_id: LayerId,
    target_layer_id: LayerId,
    contours: HashMap<ContourId, ContourId>,
    points: HashMap<PointId, PointId>,
    anchors: HashMap<AnchorId, AnchorId>,
    components: HashMap<ComponentId, ComponentId>,
    differences: Vec<LayerDifference>,
}

impl LayerMatch {
    /// Returns whether all required structure and entity mappings agree.
    pub fn is_complete(&self) -> bool {
        self.differences.is_empty()
    }

    pub fn reference_layer_id(&self) -> &LayerId {
        &self.reference_layer_id
    }

    pub fn target_layer_id(&self) -> &LayerId {
        &self.target_layer_id
    }

    /// Returns the target identity for a matched reference contour.
    pub fn contour_for(&self, reference: &ContourId) -> Option<&ContourId> {
        self.contours.get(reference)
    }

    /// Returns the target identity for a matched reference point.
    pub fn point_for(&self, reference: &PointId) -> Option<&PointId> {
        self.points.get(reference)
    }

    /// Returns the target identity for a matched reference anchor.
    pub fn anchor_for(&self, reference: &AnchorId) -> Option<&AnchorId> {
        self.anchors.get(reference)
    }

    /// Returns the target identity for a matched reference component.
    pub fn component_for(&self, reference: &ComponentId) -> Option<&ComponentId> {
        self.components.get(reference)
    }

    /// Returns structural differences in deterministic authored order.
    pub fn differences(&self) -> &[LayerDifference] {
        &self.differences
    }

    /// Consumes the match and returns its structural differences.
    pub fn into_differences(self) -> Vec<LayerDifference> {
        self.differences
    }
}

impl GlyphLayer {
    /// Derives ordered entity matches from this reference layer to `target`.
    ///
    /// The comparison never sorts authored collections. Component identity at
    /// a given position is significant because OpenType `gvar` addresses
    /// composite components by their glyph order. When an enclosing contour or
    /// point count differs, nested differences are omitted to avoid cascading
    /// diagnostics.
    pub fn match_with(&self, target: &Self) -> LayerMatch {
        let mut differences = Vec::new();

        compare_contours(self, target, &mut differences);
        compare_anchors(self, target, &mut differences);
        compare_components(self, target, &mut differences);

        let mut layer_match = LayerMatch {
            reference_layer_id: self.id(),
            target_layer_id: target.id(),
            contours: HashMap::new(),
            points: HashMap::new(),
            anchors: HashMap::new(),
            components: HashMap::new(),
            differences,
        };
        if layer_match.is_complete() {
            layer_match.add_entity_matches(self, target);
        }

        layer_match
    }
}

impl LayerMatch {
    fn add_entity_matches(&mut self, reference: &GlyphLayer, target: &GlyphLayer) {
        for (reference_contour, target_contour) in
            reference.contours_iter().zip(target.contours_iter())
        {
            self.contours
                .insert(reference_contour.id(), target_contour.id());

            for (reference_point, target_point) in reference_contour
                .points()
                .iter()
                .zip(target_contour.points())
            {
                self.points.insert(reference_point.id(), target_point.id());
            }
        }

        for (reference, target) in reference.anchors_iter().zip(target.anchors_iter()) {
            self.anchors.insert(reference.id(), target.id());
        }

        for (reference, target) in reference.components_iter().zip(target.components_iter()) {
            self.components.insert(reference.id(), target.id());
        }
    }
}

fn compare_contours(
    reference: &GlyphLayer,
    source: &GlyphLayer,
    differences: &mut Vec<LayerDifference>,
) {
    if reference.contours().len() != source.contours().len() {
        differences.push(LayerDifference::ContourCount {
            reference: reference.contours().len(),
            source: source.contours().len(),
        });
        return;
    }

    for (contour, (reference, source)) in reference
        .contours_iter()
        .zip(source.contours_iter())
        .enumerate()
    {
        if reference.is_closed() != source.is_closed() {
            differences.push(LayerDifference::ContourClosed {
                contour,
                reference: reference.is_closed(),
                source: source.is_closed(),
            });
        }

        if reference.points().len() != source.points().len() {
            differences.push(LayerDifference::PointCount {
                contour,
                reference: reference.points().len(),
                source: source.points().len(),
            });
            continue;
        }

        for (point, (reference, source)) in
            reference.points().iter().zip(source.points()).enumerate()
        {
            if reference.point_type() == source.point_type() {
                continue;
            }

            differences.push(LayerDifference::PointType {
                contour,
                point,
                reference: reference.point_type(),
                source: source.point_type(),
            });
        }
    }
}

fn compare_anchors(
    reference: &GlyphLayer,
    source: &GlyphLayer,
    differences: &mut Vec<LayerDifference>,
) {
    if reference.anchors().len() != source.anchors().len() {
        differences.push(LayerDifference::AnchorCount {
            reference: reference.anchors().len(),
            source: source.anchors().len(),
        });
        return;
    }

    let sequence_differs = reference
        .anchors_iter()
        .zip(source.anchors_iter())
        .any(|(reference, source)| reference.name() != source.name());
    if sequence_differs {
        differences.push(LayerDifference::AnchorSequence {
            reference: anchor_sequence(reference),
            source: anchor_sequence(source),
        });
    }
}

fn anchor_sequence(layer: &GlyphLayer) -> Vec<Option<String>> {
    layer
        .anchors_iter()
        .map(|anchor| anchor.name().map(ToOwned::to_owned))
        .collect()
}

fn compare_components(
    reference: &GlyphLayer,
    source: &GlyphLayer,
    differences: &mut Vec<LayerDifference>,
) {
    let sequence_differs = reference.components().len() != source.components().len()
        || reference
            .components_iter()
            .zip(source.components_iter())
            .any(|(reference, source)| reference.base_glyph_id() != source.base_glyph_id());
    if sequence_differs {
        differences.push(LayerDifference::ComponentSequence {
            reference: component_sequence(reference),
            source: component_sequence(source),
        });
    }
}

fn component_sequence(layer: &GlyphLayer) -> Vec<GlyphId> {
    layer
        .components_iter()
        .map(|component| component.base_glyph_id())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Anchor, Component, Contour, LayerId, Point, SourceId};

    fn layer() -> GlyphLayer {
        let mut layer = GlyphLayer::with_width(
            LayerId::from_raw("layer"),
            SourceId::from_raw("source"),
            600.0,
        );
        let mut contour = Contour::from_points(
            vec![
                Point::on_curve(0.0, 0.0),
                Point::off_curve(50.0, 100.0),
                Point::on_curve(100.0, 0.0),
            ],
            true,
        );
        contour.points_mut()[1].set_smooth(true);
        layer.add_contour(contour);
        layer.add_anchor(Anchor::new(Some("top".to_string()), 50.0, 100.0));
        layer.add_component(Component::new(GlyphId::from_raw("C"), "C"));
        layer.add_component(Component::new(GlyphId::from_raw("caron.cap"), "caron.cap"));
        layer
    }

    #[test]
    fn complete_match_maps_each_reference_entity_to_the_target() {
        let reference = layer();
        let mut target = reference.clone_with_fresh_ids(
            LayerId::from_raw("target-layer"),
            SourceId::from_raw("other-source"),
        );
        target.set_width(900.0);
        target.contours_iter_mut().next().unwrap().points_mut()[0].set_position(200.0, 300.0);
        target.contours_iter_mut().next().unwrap().points_mut()[1].set_smooth(false);
        target
            .anchors_iter_mut()
            .next()
            .unwrap()
            .set_position(300.0, 400.0);
        target
            .components_iter_mut()
            .next()
            .unwrap()
            .translate(50.0, 60.0);

        let layer_match = reference.match_with(&target);
        let reference_contour = reference.contours_iter().next().unwrap();
        let target_contour = target.contours_iter().next().unwrap();

        assert!(layer_match.is_complete());
        assert_eq!(layer_match.reference_layer_id(), &reference.id());
        assert_eq!(layer_match.target_layer_id(), &target.id());
        assert_eq!(
            layer_match.contour_for(&reference_contour.id()),
            Some(&target_contour.id())
        );
        for (reference_point, target_point) in reference_contour
            .points()
            .iter()
            .zip(target_contour.points())
        {
            assert_eq!(
                layer_match.point_for(&reference_point.id()),
                Some(&target_point.id())
            );
        }
        assert_eq!(
            layer_match.anchor_for(&reference.anchors()[0].id()),
            Some(&target.anchors()[0].id())
        );
        for (reference_component, target_component) in
            reference.components_iter().zip(target.components_iter())
        {
            assert_eq!(
                layer_match.component_for(&reference_component.id()),
                Some(&target_component.id())
            );
        }
    }

    #[test]
    fn reports_each_hard_structural_difference() {
        let reference = layer();

        let mut contour_count = reference.clone();
        contour_count.add_contour(Contour::new());
        assert_eq!(
            reference.match_with(&contour_count).differences(),
            &[LayerDifference::ContourCount {
                reference: 1,
                source: 2,
            }]
        );

        let mut contour_closed = reference.clone();
        contour_closed.contours_iter_mut().next().unwrap().open();
        assert_eq!(
            reference.match_with(&contour_closed).differences(),
            &[LayerDifference::ContourClosed {
                contour: 0,
                reference: true,
                source: false,
            }]
        );

        let mut point_count = reference.clone();
        point_count
            .contours_iter_mut()
            .next()
            .unwrap()
            .points_mut()
            .pop();
        assert_eq!(
            reference.match_with(&point_count).differences(),
            &[LayerDifference::PointCount {
                contour: 0,
                reference: 3,
                source: 2,
            }]
        );

        let mut point_type = reference.clone();
        point_type.contours_iter_mut().next().unwrap().points_mut()[0]
            .set_point_type(PointType::QCurve);
        assert_eq!(
            reference.match_with(&point_type).differences(),
            &[LayerDifference::PointType {
                contour: 0,
                point: 0,
                reference: PointType::OnCurve,
                source: PointType::QCurve,
            }]
        );

        let mut anchor_count = reference.clone();
        anchor_count.clear_anchors();
        assert_eq!(
            reference.match_with(&anchor_count).differences(),
            &[LayerDifference::AnchorCount {
                reference: 1,
                source: 0,
            }]
        );

        let mut anchor_sequence = reference.clone();
        anchor_sequence
            .anchors_iter_mut()
            .next()
            .unwrap()
            .set_name(Some("bottom".to_string()));
        assert_eq!(
            reference.match_with(&anchor_sequence).differences(),
            &[LayerDifference::AnchorSequence {
                reference: vec![Some("top".to_string())],
                source: vec![Some("bottom".to_string())],
            }]
        );

        let mut component_sequence = GlyphLayer::new(
            LayerId::from_raw("components"),
            SourceId::from_raw("other-source"),
        );
        component_sequence.add_contour(reference.contours_iter().next().unwrap().clone());
        component_sequence.add_anchor(reference.anchors()[0].clone());
        component_sequence
            .add_component(Component::new(GlyphId::from_raw("caron.cap"), "caron.cap"));
        component_sequence.add_component(Component::new(GlyphId::from_raw("C"), "C"));
        assert_eq!(
            reference.match_with(&component_sequence).differences(),
            &[LayerDifference::ComponentSequence {
                reference: vec![GlyphId::from_raw("C"), GlyphId::from_raw("caron.cap")],
                source: vec![GlyphId::from_raw("caron.cap"), GlyphId::from_raw("C")],
            }]
        );
    }

    #[test]
    fn enclosing_count_differences_do_not_cascade() {
        let reference = layer();
        let mut source = reference.clone();
        let contour = source.contours_iter_mut().next().unwrap();
        contour.points_mut().pop();
        contour.points_mut()[0].set_point_type(PointType::OffCurve);

        let layer_match = reference.match_with(&source);

        assert_eq!(
            layer_match.differences(),
            &[LayerDifference::PointCount {
                contour: 0,
                reference: 3,
                source: 2,
            }]
        );
        let reference_point_id = reference
            .contours_iter()
            .next()
            .unwrap()
            .points()
            .first()
            .unwrap()
            .id();
        assert!(layer_match.point_for(&reference_point_id).is_none());
    }

    #[test]
    fn reports_independent_differences_together_in_domain_order() {
        let reference = layer();
        let source = GlyphLayer::new(
            LayerId::from_raw("empty-layer"),
            SourceId::from_raw("other-source"),
        );

        assert_eq!(
            reference.match_with(&source).into_differences(),
            vec![
                LayerDifference::ContourCount {
                    reference: 1,
                    source: 0,
                },
                LayerDifference::AnchorCount {
                    reference: 1,
                    source: 0,
                },
                LayerDifference::ComponentSequence {
                    reference: vec![GlyphId::from_raw("C"), GlyphId::from_raw("caron.cap"),],
                    source: Vec::new(),
                },
            ]
        );
    }
}
