//! Intents that edit one existing layer.

use super::*;

#[derive(Clone, Debug)]
pub struct AddPoints {
    pub layer_id: LayerId,
    /// Target contour; when `None`, derived from `before` (Rust owns
    /// identity resolution — the renderer never bookkeeps pending
    /// point→contour maps).
    pub contour_id: Option<ContourId>,
    /// Insert before this point; append when `None`.
    pub before: Option<PointId>,
    pub points: Vec<PointSeed>,
}

impl LayerIntent for AddPoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            contour_id,
            before,
            points,
        } = self;
        points
            .iter()
            .flat_map(PointSeed::coordinates)
            .require_finite(Coordinates::NewPoints)?;
        let mut point_ids = HashSet::new();
        for seed in points {
            if font.has_point_id(&seed.id) || !point_ids.insert(seed.id.clone()) {
                return Err(CoreError::DuplicatePointId(seed.id.clone()));
            }
        }

        {
            let layer = font.require_layer_mut(*layer_id)?;
            let contour_id = match (contour_id, before) {
                (Some(contour_id), _) => contour_id.clone(),
                (None, Some(before_id)) => layer.contour_of_point(before_id)?,
                (None, None) => {
                    return Err(CoreError::InvalidContourId(
                        "addPoints requires a contour or a before anchor".to_string(),
                    ));
                }
            };

            let contour = layer.contour_mut(&contour_id).require(&contour_id)?;

            let insert_at = match before {
                Some(before_id) => Some(
                    contour
                        .points()
                        .iter()
                        .position(|point| point.id() == *before_id)
                        .require(before_id)?,
                ),
                None => None,
            };

            for (offset, seed) in points.iter().enumerate() {
                let point = crate::ir::Point::new(
                    seed.id.clone(),
                    seed.x,
                    seed.y,
                    seed.point_type,
                    seed.smooth,
                );

                match insert_at {
                    Some(index) => contour.insert_point(index + offset, point),
                    None => contour.push_point(point),
                }
            }
        }

        font.record_point_ids(points.iter().map(|seed| seed.id.clone()));
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct AddContour {
    pub layer_id: LayerId,
    pub contour_id: ContourId,
    pub closed: bool,
}

impl LayerIntent for AddContour {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            contour_id,
            closed,
        } = self;
        if font.has_contour_id(contour_id) {
            return Err(CoreError::DuplicateContourId(contour_id.clone()));
        }

        {
            let layer = font.require_layer_mut(*layer_id)?;
            let mut contour = Contour::with_id(contour_id.clone());
            if *closed {
                contour.close();
            }

            layer.add_contour(contour);
        }

        font.record_contour_id(contour_id.clone());
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct SetContourClosed {
    pub layer_id: LayerId,
    pub contour_id: ContourId,
    pub closed: bool,
}

impl LayerIntent for SetContourClosed {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            contour_id,
            closed,
        } = self;
        let layer = font.require_layer_mut(*layer_id)?;
        if *closed {
            layer.close_contour(contour_id)?;
        } else {
            layer.open_contour(contour_id)?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct MovePoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
    /// Interleaved absolute coordinates: x0, y0, x1, y1, …
    pub coords: Vec<f64>,
}

impl LayerIntent for MovePoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
            coords,
        } = self;
        coords
            .iter()
            .copied()
            .require_finite(Coordinates::PointPositions)?;
        if coords.len() != point_ids.len() * 2 {
            return Err(CoreError::InvalidPointId(format!(
                "movePoints expects {} coords for {} points, got {}",
                point_ids.len() * 2,
                point_ids.len(),
                coords.len()
            )));
        }

        let layer = font.require_layer_mut(*layer_id)?;
        layer.apply_bulk_node_positions(BulkNodePositionUpdates {
            point_ids: Some(point_ids),
            point_coords: Some(coords),
            anchor_ids: None,
            anchor_coords: None,
        })?;

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct SetPointSmooth {
    pub layer_id: LayerId,
    pub point_id: PointId,
    pub smooth: bool,
}

impl LayerIntent for SetPointSmooth {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_id,
            smooth,
        } = self;
        let layer = font.require_layer_mut(*layer_id)?;
        layer.set_point_smooth(point_id, *smooth)?;

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct RemovePoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
}

impl LayerIntent for RemovePoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
        } = self;
        let before = font.layer_snapshot(*layer_id)?;
        let empty_contours = {
            let layer = font.require_layer_mut(*layer_id)?;
            layer.remove_points(point_ids)?
        };

        if empty_contours.is_empty() {
            font.forget_point_ids(point_ids);
        } else {
            font.reindex_layer(*layer_id, &before)?;
        }

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct AddAnchors {
    pub layer_id: LayerId,
    pub anchors: Vec<AnchorSeed>,
}

impl LayerIntent for AddAnchors {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self { layer_id, anchors } = self;
        anchors
            .iter()
            .flat_map(AnchorSeed::coordinates)
            .require_finite(Coordinates::NewAnchors)?;
        let mut anchor_ids = HashSet::new();
        for seed in anchors {
            if font.has_anchor_id(&seed.id) || !anchor_ids.insert(seed.id.clone()) {
                return Err(CoreError::DuplicateAnchorId(seed.id.clone()));
            }
        }

        {
            let layer = font.require_layer_mut(*layer_id)?;
            for seed in anchors {
                layer.add_anchor(Anchor::with_id(
                    seed.id.clone(),
                    seed.name.clone(),
                    seed.x,
                    seed.y,
                ));
            }
        }

        font.record_anchor_ids(anchors.iter().map(|seed| seed.id.clone()));
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct MoveAnchors {
    pub layer_id: LayerId,
    pub anchor_ids: Vec<AnchorId>,
    /// Interleaved absolute coordinates: x0, y0, x1, y1, …
    pub coords: Vec<f64>,
}

impl LayerIntent for MoveAnchors {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            anchor_ids,
            coords,
        } = self;
        coords
            .iter()
            .copied()
            .require_finite(Coordinates::AnchorPositions)?;
        if coords.len() != anchor_ids.len() * 2 {
            return Err(CoreError::InvalidAnchorId(format!(
                "moveAnchors expects {} coords for {} anchors, got {}",
                anchor_ids.len() * 2,
                anchor_ids.len(),
                coords.len()
            )));
        }

        let layer = font.require_layer_mut(*layer_id)?;
        layer.apply_bulk_node_positions(BulkNodePositionUpdates {
            point_ids: None,
            point_coords: None,
            anchor_ids: Some(anchor_ids),
            anchor_coords: Some(coords),
        })?;

        Ok(())
    }
}

/// Sets every point and anchor position of a layer at once: a move of many
/// points that names none of them, so it costs numbers, not ids.
#[derive(Clone, Debug)]
pub struct SetPositions {
    pub layer_id: LayerId,
    /// Every contour point, contour after contour, then every anchor, each as
    /// `x, y`.
    pub positions: Vec<f64>,
}

impl LayerIntent for SetPositions {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            positions,
        } = self;
        positions
            .iter()
            .copied()
            .require_finite(Coordinates::PointPositions)?;
        font.require_layer_mut(*layer_id)?.set_positions(positions)
    }
}

#[derive(Clone, Debug)]
pub struct RemoveAnchors {
    pub layer_id: LayerId,
    pub anchor_ids: Vec<AnchorId>,
}

impl LayerIntent for RemoveAnchors {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            anchor_ids,
        } = self;
        {
            let layer = font.require_layer_mut(*layer_id)?;
            layer.remove_anchors(anchor_ids)?;
        }

        font.forget_anchor_ids(anchor_ids);
        Ok(())
    }
}

/// Renames anchors in one layer; `names[i]` is the new name of `anchor_ids[i]`.
#[derive(Clone, Debug)]
pub struct RenameAnchors {
    pub layer_id: LayerId,
    pub anchor_ids: Vec<AnchorId>,
    pub names: Vec<String>,
}

impl LayerIntent for RenameAnchors {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            anchor_ids,
            names,
        } = self;
        if names.len() != anchor_ids.len() {
            return Err(CoreError::InvalidAnchorId(format!(
                "renameAnchors expects {} names for {} anchors, got {}",
                anchor_ids.len(),
                anchor_ids.len(),
                names.len()
            )));
        }

        let layer = font.require_layer_mut(*layer_id)?;
        for anchor_id in anchor_ids {
            if layer.anchor(anchor_id).is_none() {
                return Err(CoreError::AnchorNotFound(anchor_id.clone()));
            }
        }
        for (anchor_id, name) in anchor_ids.iter().zip(names) {
            if let Some(anchor) = layer.anchor_mut(anchor_id) {
                anchor.set_name(name.clone());
            }
        }

        Ok(())
    }
}

/// Adds one direct reference after rejecting direct or transitive component cycles.
#[derive(Clone, Debug)]
pub struct AddComponent {
    pub layer_id: LayerId,
    pub component_id: ComponentId,
    pub base_glyph_id: GlyphId,
}

impl LayerIntent for AddComponent {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            component_id,
            base_glyph_id,
        } = self;
        if font.has_component_id(component_id) {
            return Err(CoreError::DuplicateComponentId(component_id.clone()));
        }
        let glyph_id = font.require_layer_owner(*layer_id)?;
        let base_glyph_name = font.require_glyph(*base_glyph_id)?.glyph_name().clone();
        if font.component_reference_would_cycle(glyph_id, *base_glyph_id) {
            return Err(CoreError::CyclicComponentReference {
                glyph_id,
                base_glyph_id: *base_glyph_id,
            });
        }

        let aligned = font.anchor_aligned_component_transform(*layer_id, *base_glyph_id)?;
        let before = font.layer_snapshot(*layer_id)?;
        {
            let layer = font.require_layer_mut(*layer_id)?;
            let mut component = Component::with_id(
                component_id.clone(),
                *base_glyph_id,
                base_glyph_name,
                aligned.unwrap_or_default(),
            );
            component.set_alignment(if aligned.is_some() {
                ComponentAlignment::Anchored
            } else {
                ComponentAlignment::Free
            });
            layer.add_component(component);
        }

        font.reindex_layer(*layer_id, &before)?;
        Ok(())
    }
}

/// Replaces direct component transforms without changing component identity or order.
#[derive(Clone, Debug)]
pub struct SetComponentTransforms {
    pub layer_id: LayerId,
    pub component_ids: Vec<ComponentId>,
    /// Nine decomposed values per component in interpolation order.
    pub transforms: Vec<f64>,
}

impl LayerIntent for SetComponentTransforms {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            component_ids,
            transforms,
        } = self;
        let expected = component_ids.len() * DecomposedTransform::VALUE_COUNT;
        if transforms.len() != expected {
            return Err(CoreError::InvalidPositionUpdateInput {
                kind: "component transforms",
                message: format!(
                    "expected {} values for {} components, got {}",
                    expected,
                    component_ids.len(),
                    transforms.len()
                ),
            });
        }
        transforms
            .iter()
            .copied()
            .require_finite(Coordinates::ComponentTransforms)?;

        let layer = font.require_layer_mut(*layer_id)?;
        for component_id in component_ids {
            if layer.component(component_id).is_none() {
                return Err(CoreError::InvalidComponentId(component_id.to_string()));
            }
        }
        let (transforms, _) = transforms.as_chunks::<{ DecomposedTransform::VALUE_COUNT }>();
        for (component_id, values) in component_ids.iter().zip(transforms) {
            layer
                .set_component_transform(component_id, DecomposedTransform::from_values(*values))?;
        }

        Ok(())
    }
}

/// Records whether components are placed by their anchors; anchoring one
/// also places it on its anchors now.
#[derive(Clone, Debug)]
pub struct SetComponentAlignment {
    pub layer_id: LayerId,
    pub component_ids: Vec<ComponentId>,
    pub alignment: ComponentAlignment,
}

impl LayerIntent for SetComponentAlignment {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            component_ids,
            alignment,
        } = self;
        let layer = font.require_layer_mut(*layer_id)?;
        for component_id in component_ids {
            if layer.component(component_id).is_none() {
                return Err(CoreError::InvalidComponentId(component_id.to_string()));
            }
        }
        for component in layer.components_iter_mut() {
            if component_ids.contains(&component.id()) {
                component.set_alignment(*alignment);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct RemoveComponents {
    pub layer_id: LayerId,
    pub component_ids: Vec<ComponentId>,
}

impl LayerIntent for RemoveComponents {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            component_ids,
        } = self;
        let before = font.layer_snapshot(*layer_id)?;
        {
            let layer = font.require_layer_mut(*layer_id)?;
            for component_id in component_ids {
                if layer.component(component_id).is_none() {
                    return Err(CoreError::InvalidComponentId(component_id.to_string()));
                }
            }
            for component_id in component_ids {
                layer.remove_component(component_id);
            }
        }

        font.reindex_layer(*layer_id, &before)?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct DecomposeComponents {
    pub layer_id: LayerId,
    pub component_ids: Vec<ComponentId>,
}

impl LayerIntent for DecomposeComponents {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            component_ids,
        } = self;
        let layer = font.require_layer(*layer_id)?;
        for component_id in component_ids {
            if layer.component(component_id).is_none() {
                return Err(CoreError::InvalidComponentId(component_id.to_string()));
            }
        }
        let resolved_contours = font.layer_component_contours(
            *layer_id,
            &component_ids.iter().cloned().collect::<HashSet<_>>(),
        )?;

        let before = font.layer_snapshot(*layer_id)?;
        {
            let layer = font.require_layer_mut(*layer_id)?;
            for component_id in component_ids {
                layer.remove_component(component_id);
            }
            for resolved in resolved_contours {
                let mut contour = Contour::new();
                for point in resolved.points {
                    contour.push_point(point);
                }
                if resolved.closed {
                    contour.close();
                }
                layer.add_contour(contour);
            }
        }

        font.reindex_layer(*layer_id, &before)?;
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct ReverseContour {
    pub layer_id: LayerId,
    pub contour_id: ContourId,
}

impl LayerIntent for ReverseContour {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            contour_id,
        } = self;
        let layer = font.require_layer_mut(*layer_id)?;
        layer.reverse_contour(contour_id)?;

        Ok(())
    }
}

/// Rotates a closed contour to an existing on-curve point without changing its geometry.
#[derive(Clone, Debug)]
pub struct SetContourStart {
    pub layer_id: LayerId,
    pub contour_id: ContourId,
    pub point_id: PointId,
}

impl LayerIntent for SetContourStart {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            contour_id,
            point_id,
        } = self;
        let layer = font.require_layer_mut(*layer_id)?;
        layer.set_contour_start(contour_id, point_id)?;

        Ok(())
    }
}

/// Affine move: O(selection-ids) wire instead of O(N) coords.
#[derive(Clone, Debug)]
pub struct TranslatePoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
    pub dx: f64,
    pub dy: f64,
}

impl LayerIntent for TranslatePoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
            dx,
            dy,
        } = self;
        [*dx, *dy].require_finite(Coordinates::PointTranslation)?;
        let layer = font.require_layer_mut(*layer_id)?;
        layer.move_points(point_ids, *dx, *dy)?;

        Ok(())
    }
}

/// Affine transform of the whole layer: every contour point, anchor, and
/// component placement. The advance width is unchanged.
#[derive(Clone, Debug)]
pub struct TransformLayer {
    pub layer_id: LayerId,
    pub transform: Transform,
}

impl LayerIntent for TransformLayer {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            transform,
        } = self;
        transform
            .to_values()
            .require_finite(Coordinates::LayerTransform)?;

        font.require_layer_mut(*layer_id)?
            .transform_layer(transform);
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct SetXAdvance {
    pub layer_id: LayerId,
    pub width: f64,
}

impl LayerIntent for SetXAdvance {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self { layer_id, width } = self;
        [*width].require_finite(Coordinates::AdvanceWidth)?;
        let layer = font.require_layer_mut(*layer_id)?;
        layer.set_x_advance(*width);

        Ok(())
    }
}

/// Rust-only computation: the echo is the same replace-grade shape as
/// every other intent — remote changes are not a special case.
#[derive(Clone, Debug)]
pub struct ApplyBooleanOp {
    pub layer_id: LayerId,
    pub contour_id_a: ContourId,
    pub contour_id_b: ContourId,
    pub operation: BooleanOp,
}

impl LayerIntent for ApplyBooleanOp {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            contour_id_a,
            contour_id_b,
            operation,
        } = self;
        let before = font.layer_snapshot(*layer_id)?;
        {
            let layer = font.require_layer_mut(*layer_id)?;
            layer.apply_boolean_op(contour_id_a, contour_id_b, *operation)?;
        }

        font.reindex_layer(*layer_id, &before)?;
        Ok(())
    }
}

/// Deletes points and reconnects what survives: see [`GlyphLayer::delete_points`].
#[derive(Clone, Debug)]
pub struct DeletePoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
    pub mode: DeleteMode,
}

impl LayerIntent for DeletePoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
            mode,
        } = self;
        font.edit_layer(*layer_id, |layer| layer.delete_points(point_ids, *mode))
    }
}

/// Splits a segment at `t`, keeping its shape: see [`GlyphLayer::split_segment`].
#[derive(Clone, Debug)]
pub struct SplitSegment {
    pub layer_id: LayerId,
    pub start_id: PointId,
    pub end_id: PointId,
    pub t: f64,
    /// The new on-curve point, minted by the caller so it can keep drawing from it.
    pub point_id: PointId,
}

impl LayerIntent for SplitSegment {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            start_id,
            end_id,
            t,
            point_id,
        } = self;
        font.edit_layer(*layer_id, |layer| {
            layer.split_segment(start_id, end_id, *t, point_id.clone())
        })
    }
}

/// Raises a line to a cubic of the same shape: see [`GlyphLayer::upgrade_line_to_cubic`].
#[derive(Clone, Debug)]
pub struct UpgradeLineToCubic {
    pub layer_id: LayerId,
    pub start_id: PointId,
    pub end_id: PointId,
}

impl LayerIntent for UpgradeLineToCubic {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            start_id,
            end_id,
        } = self;
        font.edit_layer(*layer_id, |layer| {
            layer.upgrade_line_to_cubic(start_id, end_id)
        })
    }
}

/// Closes a contour or joins two by their ends: see [`GlyphLayer::join_contours`].
#[derive(Clone, Debug)]
pub struct JoinContours {
    pub layer_id: LayerId,
    pub from: ContourEnd,
    pub to: ContourEnd,
    pub mode: JoinMode,
}

impl LayerIntent for JoinContours {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            from,
            to,
            mode,
        } = self;
        font.edit_layer(*layer_id, |layer| layer.join_contours(from, to, *mode))
    }
}

/// Moves points by one affine transform.
#[derive(Clone, Debug)]
pub struct TransformPoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
    pub transform: Transform,
}

impl LayerIntent for TransformPoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
            transform,
        } = self;
        transform
            .to_values()
            .require_finite(Coordinates::PointTransform)?;
        font.require_layer_mut(*layer_id)?
            .transform_points(point_ids, transform)
    }
}

/// Lines points up on an edge or centre of their box: see [`GlyphLayer::align_points`].
#[derive(Clone, Debug)]
pub struct AlignPoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
    pub alignment: PointAlignment,
}

impl LayerIntent for AlignPoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
            alignment,
        } = self;
        font.require_layer_mut(*layer_id)?
            .align_points(point_ids, *alignment)
    }
}

/// Spaces points evenly along an axis: see [`GlyphLayer::distribute_points`].
#[derive(Clone, Debug)]
pub struct DistributePoints {
    pub layer_id: LayerId,
    pub point_ids: Vec<PointId>,
    pub axis: DistributeAxis,
}

impl LayerIntent for DistributePoints {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            point_ids,
            axis,
        } = self;
        font.require_layer_mut(*layer_id)?
            .distribute_points(point_ids, *axis)
    }
}

/// Adds to one sidebearing: see [`GlyphLayer::shift_sidebearing`].
#[derive(Clone, Debug)]
pub struct ShiftSidebearing {
    pub layer_id: LayerId,
    pub sidebearing: Sidebearing,
    pub delta: f64,
}

impl LayerIntent for ShiftSidebearing {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn structural(&self) -> bool {
        false
    }

    fn may_move_anchors(&self) -> bool {
        self.sidebearing == Sidebearing::Left
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            sidebearing,
            delta,
        } = self;
        [*delta].require_finite(Coordinates::SidebearingDelta)?;
        font.require_layer_mut(*layer_id)?
            .shift_sidebearing(*sidebearing, *delta);
        Ok(())
    }
}

impl Font {
    /// Runs `edit` on a layer and reindexes it against the layer as it was.
    fn edit_layer(
        &mut self,
        layer_id: LayerId,
        edit: impl FnOnce(&mut GlyphLayer) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let before = self.layer_snapshot(layer_id)?;
        edit(self.require_layer_mut(layer_id)?)?;
        self.reindex_layer(layer_id, &before)
    }
}

/// Replaces drawing content while preserving layer identity, source, height, guidelines, and lib.
///
/// Values use font units and supplied entity identities. The complete replacement
/// is validated before installation and refreshes component dependencies.
#[derive(Clone, Debug)]
pub struct ReplaceGlyphLayerContent {
    pub layer_id: LayerId,
    pub width: f64,
    pub contours: Vec<Contour>,
    pub anchors: Vec<Anchor>,
    pub components: Vec<Component>,
}

impl LayerIntent for ReplaceGlyphLayerContent {
    fn layer_id(&self) -> &LayerId {
        &self.layer_id
    }

    fn may_move_anchors(&self) -> bool {
        true
    }

    fn apply(&self, font: &mut Font) -> CoreResult<()> {
        let Self {
            layer_id,
            width,
            contours,
            anchors,
            components,
        } = self;
        let glyph_id = font
            .glyph_id_by_layer(*layer_id)
            .ok_or(CoreError::LayerNotFound(*layer_id))?;
        for component in components {
            let base_glyph_id = component.base_glyph_id();
            if font.glyph(base_glyph_id).is_none() {
                return Err(CoreError::GlyphNotFound(base_glyph_id));
            }
            if font.component_reference_would_cycle(glyph_id, base_glyph_id) {
                return Err(CoreError::CyclicComponentReference {
                    glyph_id,
                    base_glyph_id,
                });
            }
        }
        let mut layer = font
            .layer(*layer_id)
            .ok_or(CoreError::LayerNotFound(*layer_id))?
            .clone();
        layer.replace_content(
            *width,
            contours.clone(),
            anchors.clone(),
            components.clone(),
        )?;
        font.replace_glyph_layers(vec![layer])?;

        Ok(())
    }
}
