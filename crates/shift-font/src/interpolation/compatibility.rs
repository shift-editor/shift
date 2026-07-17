//! Structural compatibility between ordered authored glyph layers.

use crate::{GlyphId, GlyphLayer, PointType};

/// One structural difference that prevents two glyph layers from sharing values.
///
/// Paths, nodes, anchors, and components are compared in authored order. This
/// follows the positional correspondence required by outline interpolation and
/// by OpenType `gvar`, where composite variation indices address components in
/// glyph order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LayerDifference {
    /// The layers contain different numbers of paths.
    PathCount { reference: usize, source: usize },
    /// The path at the given position is open in one layer and closed in the other.
    PathClosed {
        path: usize,
        reference: bool,
        source: bool,
    },
    /// Corresponding paths contain different numbers of nodes.
    NodeCount {
        path: usize,
        reference: usize,
        source: usize,
    },
    /// Corresponding nodes have different authored point kinds.
    NodeKind {
        path: usize,
        node: usize,
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

/// Complete structural comparison of a source layer with a reference layer.
///
/// An empty difference list means that both layers can share Shift's canonical
/// structure-ordered interpolation values. Coordinates, advance width, smooth
/// flags, anchor positions, and component transforms are values rather than
/// structural compatibility constraints.
#[derive(Clone, Debug, Eq, PartialEq)]
#[must_use]
pub struct LayerCompatibility {
    differences: Vec<LayerDifference>,
}

impl LayerCompatibility {
    /// Returns whether the source can share the reference layer's structure.
    pub fn is_compatible(&self) -> bool {
        self.differences.is_empty()
    }

    /// Returns structural differences in deterministic authored order.
    pub fn differences(&self) -> &[LayerDifference] {
        &self.differences
    }

    /// Consumes the comparison and returns its structural differences.
    pub fn into_differences(self) -> Vec<LayerDifference> {
        self.differences
    }
}

impl GlyphLayer {
    /// Compares a source layer with this reference topology for interpolation.
    ///
    /// The comparison never sorts authored collections. Component identity at
    /// a given position is significant because OpenType `gvar` addresses
    /// composite components by their glyph order. When an enclosing path or
    /// node count differs, nested differences are omitted to avoid cascading
    /// diagnostics.
    pub fn interpolation_compatibility_with(&self, source: &Self) -> LayerCompatibility {
        let mut differences = Vec::new();

        compare_paths(self, source, &mut differences);
        compare_anchors(self, source, &mut differences);
        compare_components(self, source, &mut differences);

        LayerCompatibility { differences }
    }
}

fn compare_paths(
    reference: &GlyphLayer,
    source: &GlyphLayer,
    differences: &mut Vec<LayerDifference>,
) {
    if reference.contours().len() != source.contours().len() {
        differences.push(LayerDifference::PathCount {
            reference: reference.contours().len(),
            source: source.contours().len(),
        });
        return;
    }

    for (path, (reference, source)) in reference
        .contours_iter()
        .zip(source.contours_iter())
        .enumerate()
    {
        if reference.is_closed() != source.is_closed() {
            differences.push(LayerDifference::PathClosed {
                path,
                reference: reference.is_closed(),
                source: source.is_closed(),
            });
        }

        if reference.points().len() != source.points().len() {
            differences.push(LayerDifference::NodeCount {
                path,
                reference: reference.points().len(),
                source: source.points().len(),
            });
            continue;
        }

        for (node, (reference, source)) in
            reference.points().iter().zip(source.points()).enumerate()
        {
            if reference.point_type() == source.point_type() {
                continue;
            }

            differences.push(LayerDifference::NodeKind {
                path,
                node,
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
    fn compatible_layers_may_change_interpolated_values_and_metadata() {
        let reference = layer();
        let mut source = reference.clone_with_fresh_ids(
            LayerId::from_raw("source-layer"),
            SourceId::from_raw("other-source"),
        );
        source.set_width(900.0);
        source.contours_iter_mut().next().unwrap().points_mut()[0].set_position(200.0, 300.0);
        source.contours_iter_mut().next().unwrap().points_mut()[1].set_smooth(false);
        source
            .anchors_iter_mut()
            .next()
            .unwrap()
            .set_position(300.0, 400.0);
        source
            .components_iter_mut()
            .next()
            .unwrap()
            .translate(50.0, 60.0);

        assert!(reference
            .interpolation_compatibility_with(&source)
            .is_compatible());
    }

    #[test]
    fn reports_each_hard_structural_difference() {
        let reference = layer();

        let mut path_count = reference.clone();
        path_count.add_contour(Contour::new());
        assert_eq!(
            reference
                .interpolation_compatibility_with(&path_count)
                .differences(),
            &[LayerDifference::PathCount {
                reference: 1,
                source: 2,
            }]
        );

        let mut path_closed = reference.clone();
        path_closed.contours_iter_mut().next().unwrap().open();
        assert_eq!(
            reference
                .interpolation_compatibility_with(&path_closed)
                .differences(),
            &[LayerDifference::PathClosed {
                path: 0,
                reference: true,
                source: false,
            }]
        );

        let mut node_count = reference.clone();
        node_count
            .contours_iter_mut()
            .next()
            .unwrap()
            .points_mut()
            .pop();
        assert_eq!(
            reference
                .interpolation_compatibility_with(&node_count)
                .differences(),
            &[LayerDifference::NodeCount {
                path: 0,
                reference: 3,
                source: 2,
            }]
        );

        let mut node_kind = reference.clone();
        node_kind.contours_iter_mut().next().unwrap().points_mut()[0]
            .set_point_type(PointType::QCurve);
        assert_eq!(
            reference
                .interpolation_compatibility_with(&node_kind)
                .differences(),
            &[LayerDifference::NodeKind {
                path: 0,
                node: 0,
                reference: PointType::OnCurve,
                source: PointType::QCurve,
            }]
        );

        let mut anchor_count = reference.clone();
        anchor_count.clear_anchors();
        assert_eq!(
            reference
                .interpolation_compatibility_with(&anchor_count)
                .differences(),
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
            reference
                .interpolation_compatibility_with(&anchor_sequence)
                .differences(),
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
            reference
                .interpolation_compatibility_with(&component_sequence)
                .differences(),
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

        assert_eq!(
            reference
                .interpolation_compatibility_with(&source)
                .differences(),
            &[LayerDifference::NodeCount {
                path: 0,
                reference: 3,
                source: 2,
            }]
        );
    }

    #[test]
    fn reports_independent_differences_together_in_domain_order() {
        let reference = layer();
        let source = GlyphLayer::new(
            LayerId::from_raw("empty-layer"),
            SourceId::from_raw("other-source"),
        );

        assert_eq!(
            reference
                .interpolation_compatibility_with(&source)
                .into_differences(),
            vec![
                LayerDifference::PathCount {
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
