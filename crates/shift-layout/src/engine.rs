//! Shift's layout tree as a Taffy tree.
//!
//! Taffy lays out rows and columns with its flexbox algorithm; everything
//! else is decided here. Each node becomes a [`Slot`] holding the Taffy style
//! its authored values translate to. A row or column shows Taffy only the
//! children that follow its layout; children of free frames and the page,
//! and absolute children, are sized here as if alone and set at their
//! positions, so Taffy's absolute positioning is never used. Text runs are
//! Taffy leaves whose measure function breaks lines over their segments.
//!
//! Nothing in Taffy's types leaves this module.

use std::iter::Copied;
use std::slice::Iter;

use taffy::style_helpers::TaffyMaxContent;
use taffy::{
    AlignContent, AlignItems, AvailableSpace, Cache, CacheTree, Dimension, Display, FlexDirection,
    FlexWrap, JustifyContent, LayoutFlexboxContainer, LayoutInput, LayoutOutput, LayoutPartialTree,
    LengthPercentage, Line, NodeId, Point, Rect, RequestedAxis, RunMode, Size, SizingMode, Style,
    TraversePartialTree, compute_cached_layout, compute_flexbox_layout, compute_leaf_layout,
};

use crate::page::{LayoutBox, LayoutError, PageLayout, TextLines};
use crate::text::BreakSegments;
use crate::tree::{
    Align, FrameLayout, Insets, Justify, LayoutMode, LayoutNode, LayoutTree, NodeKind, Placement,
    Sizing,
};

/// One page's nodes, in input order, as Taffy lays them out.
pub(crate) struct Engine<'a> {
    slots: Vec<Slot<'a>>,
}

/// How a node lays out its content.
#[derive(Clone, Copy)]
enum Content<'a> {
    /// The page or a free frame: children keep their positions.
    Free,
    /// A row or column: Taffy's flexbox.
    Stack,
    Text(&'a BreakSegments),
    Fixed(Size<f32>),
}

struct Slot<'a> {
    content: Content<'a>,
    style: Style,
    /// Sizing as it lays out: `Fill` only under a row or column, and `Hug`
    /// for a text run's height and both of the page's axes.
    width: Sizing,
    height: Sizing,
    position: Point<f32>,
    /// Children that follow this row or column's layout, in order.
    flow: Vec<NodeId>,
    /// Children that keep their positions.
    placed: Vec<usize>,
    cache: Cache,
    location: Point<f32>,
    size: Size<f32>,
}

impl<'a> Engine<'a> {
    /// Validates `tree` and translates every node.
    pub(crate) fn new(tree: &'a LayoutTree) -> Result<Self, LayoutError> {
        let nodes = &tree.nodes;
        let root = nodes.first().ok_or(LayoutError::Empty)?;
        if root.parent.is_some() || root.kind != NodeKind::Page {
            return Err(LayoutError::RootNotPage);
        }

        let mut slots: Vec<Slot<'a>> = Vec::with_capacity(nodes.len());
        for (index, node) in nodes.iter().enumerate() {
            let parent_mode = parent_mode(nodes, index, node)?;
            let flow =
                parent_mode.filter(|mode| mode.is_stack() && node.placement == Placement::Auto);
            slots.push(Slot::new(node, flow));
            let Some(parent) = node.parent.and_then(|parent| slots.get_mut(parent)) else {
                continue;
            };
            if flow.is_some() {
                parent.flow.push(NodeId::from(index));
            } else {
                parent.placed.push(index);
            }
        }
        Ok(Self { slots })
    }

    /// Lays out the page and reads every box and text run's lines.
    pub(crate) fn run(mut self) -> PageLayout {
        let root = NodeId::from(0_usize);
        let output = self.compute_child_layout(root, alone(RunMode::PerformLayout));
        let page = self.slot_mut(root);
        page.location = page.position;
        page.size = output.size;

        let boxes = self.slots.iter().map(Slot::layout_box).collect();
        let text_lines = self
            .slots
            .iter()
            .enumerate()
            .filter_map(|(node, slot)| slot.text_lines(node))
            .collect();
        PageLayout { boxes, text_lines }
    }

    fn slot(&self, id: NodeId) -> &Slot<'a> {
        &self.slots[usize::from(id)]
    }

    fn slot_mut(&mut self, id: NodeId) -> &mut Slot<'a> {
        &mut self.slots[usize::from(id)]
    }

    fn compute_uncached(&mut self, id: NodeId, inputs: LayoutInput) -> LayoutOutput {
        match self.slot(id).content {
            Content::Stack => {
                let output = compute_flexbox_layout(self, id, inputs);
                if inputs.run_mode == RunMode::PerformLayout {
                    self.place_children(id, RunMode::PerformLayout);
                }
                output
            }
            Content::Free => self.compute_free(id, inputs),
            Content::Text(segments) => {
                let slot = self.slot(id);
                compute_leaf_layout(
                    inputs,
                    &slot.style,
                    |_, _| 0.0,
                    |known, available| measure_text(segments, slot.width, known, available),
                )
            }
            Content::Fixed(size) => compute_leaf_layout(
                inputs,
                &self.slot(id).style,
                |_, _| 0.0,
                |known, _| known.unwrap_or(size),
            ),
        }
    }

    /// Sizes a free frame or the page: its fixed size on an axis that has
    /// one, otherwise far enough to cover its children.
    fn compute_free(&mut self, id: NodeId, inputs: LayoutInput) -> LayoutOutput {
        let slot = self.slot(id);
        let own = inputs.known_dimensions.or(Size {
            width: fixed(slot.width),
            height: fixed(slot.height),
        });
        let needs_children = inputs.run_mode == RunMode::PerformLayout
            || own.width.is_none()
            || own.height.is_none();
        let extent = if needs_children {
            self.place_children(id, inputs.run_mode)
        } else {
            Size::ZERO
        };
        LayoutOutput::from_outer_size(own.unwrap_or(extent))
    }

    /// Sizes each child that keeps its position as if it were alone, and on
    /// [`RunMode::PerformLayout`] sets it there. Returns how far right and
    /// down the children reach from this node's origin, never negative.
    fn place_children(&mut self, id: NodeId, run_mode: RunMode) -> Size<f32> {
        let mut extent = Size::ZERO;
        for index in 0..self.slot(id).placed.len() {
            let child = NodeId::from(self.slot(id).placed[index]);
            let output = self.compute_child_layout(child, alone(run_mode));
            let slot = self.slot_mut(child);
            extent.width = extent.width.max(slot.position.x + output.size.width);
            extent.height = extent.height.max(slot.position.y + output.size.height);
            if run_mode == RunMode::PerformLayout {
                slot.location = slot.position;
                slot.size = output.size;
            }
        }
        extent
    }
}

/// Returns the layout mode of `node`'s parent; `None` for the page.
fn parent_mode(
    nodes: &[LayoutNode],
    index: usize,
    node: &LayoutNode,
) -> Result<Option<LayoutMode>, LayoutError> {
    if index == 0 {
        return Ok(None);
    }
    if node.kind == NodeKind::Page {
        return Err(LayoutError::NestedPage { node: index });
    }
    if let NodeKind::Text(segments) = &node.kind
        && !(segments.scale.is_finite() && segments.scale > 0.0)
    {
        return Err(LayoutError::InvalidScale {
            node: index,
            scale: segments.scale,
        });
    }

    let parent = node.parent.ok_or(LayoutError::SecondRoot { node: index })?;
    let parent_node =
        nodes
            .get(parent)
            .filter(|_| parent < index)
            .ok_or(LayoutError::ParentNotBefore {
                node: index,
                parent,
            })?;
    match &parent_node.kind {
        NodeKind::Page => Ok(Some(LayoutMode::Free)),
        NodeKind::Frame(frame) => Ok(Some(frame.mode)),
        NodeKind::Text(_) | NodeKind::Fixed(_) => Err(LayoutError::ParentIsLeaf {
            node: index,
            parent,
        }),
    }
}

impl<'a> Slot<'a> {
    /// Translates `node`; `flow` is the parent's mode when the node follows a
    /// row or column.
    fn new(node: &'a LayoutNode, flow: Option<LayoutMode>) -> Self {
        let laid_out = |sizing: Sizing| match (sizing, flow) {
            (Sizing::Fill, None) => Sizing::Hug,
            _ => sizing,
        };
        let (width, height) = match node.kind {
            NodeKind::Page => (Sizing::Hug, Sizing::Hug),
            NodeKind::Text(_) => (laid_out(node.width), Sizing::Hug),
            NodeKind::Frame(_) | NodeKind::Fixed(_) => {
                (laid_out(node.width), laid_out(node.height))
            }
        };

        let mut style = Style {
            size: Size {
                width: dimension(width),
                height: dimension(height),
            },
            flex_shrink: 0.0,
            ..Style::default()
        };
        if let Some(mode) = flow {
            follow(&mut style, mode, width, height);
        }
        let content = match &node.kind {
            NodeKind::Frame(frame) if frame.mode.is_stack() => {
                stack(&mut style, frame);
                Content::Stack
            }
            NodeKind::Page | NodeKind::Frame(_) => Content::Free,
            NodeKind::Text(segments) => Content::Text(segments),
            NodeKind::Fixed(size) => Content::Fixed(Size {
                width: to_f32(size.width),
                height: to_f32(size.height),
            }),
        };

        Self {
            content,
            style,
            width,
            height,
            position: Point {
                x: to_f32(node.position.x),
                y: to_f32(node.position.y),
            },
            flow: Vec::new(),
            placed: Vec::new(),
            cache: Cache::new(),
            location: Point::ZERO,
            size: Size::ZERO,
        }
    }

    fn layout_box(&self) -> LayoutBox {
        LayoutBox {
            x: f64::from(self.location.x),
            y: f64::from(self.location.y),
            width: f64::from(self.size.width),
            height: f64::from(self.size.height),
        }
    }

    /// The lines of a text run at its laid-out width.
    fn text_lines(&self, node: usize) -> Option<TextLines> {
        let Content::Text(segments) = self.content else {
            return None;
        };
        let available = match self.width {
            Sizing::Hug => f64::INFINITY,
            Sizing::Fixed(_) | Sizing::Fill => f64::from(self.size.width) / segments.scale,
        };
        Some(TextLines {
            node,
            lines: segments.break_lines(available),
        })
    }
}

/// Styles an item of a row or column: `Fill` grows along the main axis and
/// stretches across it; other sizes neither grow nor shrink.
fn follow(style: &mut Style, mode: LayoutMode, width: Sizing, height: Sizing) {
    let (main, cross) = match mode {
        LayoutMode::Row => (width, height),
        LayoutMode::Column | LayoutMode::Free => (height, width),
    };
    if main == Sizing::Fill {
        style.flex_grow = 1.0;
        style.flex_shrink = 1.0;
        style.flex_basis = Dimension::length(0.0);
    }
    if cross == Sizing::Fill {
        style.align_self = Some(AlignItems::STRETCH);
    }
}

/// Styles a row or column container.
fn stack(style: &mut Style, frame: &FrameLayout) {
    let gap = LengthPercentage::length(to_f32(frame.gap));
    style.display = Display::Flex;
    style.flex_direction = match frame.mode {
        LayoutMode::Row => FlexDirection::Row,
        LayoutMode::Column | LayoutMode::Free => FlexDirection::Column,
    };
    style.flex_wrap = if frame.wrap {
        FlexWrap::Wrap
    } else {
        FlexWrap::NoWrap
    };
    style.gap = Size {
        width: gap,
        height: gap,
    };
    style.padding = padding(frame.padding);
    style.align_items = match frame.align {
        Align::Start => AlignItems::START,
        Align::Center => AlignItems::CENTER,
        Align::End => AlignItems::END,
        Align::Baseline => AlignItems::BASELINE,
    };
    style.justify_content = match frame.justify {
        Justify::Start => JustifyContent::START,
        Justify::Center => JustifyContent::CENTER,
        Justify::End => JustifyContent::END,
        Justify::SpaceBetween => JustifyContent::SPACE_BETWEEN,
    };
    // Wrapped lines pack at the start of the cross axis rather than
    // stretching to share it.
    style.align_content = AlignContent::START;
}

fn padding(insets: Insets) -> Rect<LengthPercentage> {
    Rect {
        left: LengthPercentage::length(to_f32(insets.left)),
        right: LengthPercentage::length(to_f32(insets.right)),
        top: LengthPercentage::length(to_f32(insets.top)),
        bottom: LengthPercentage::length(to_f32(insets.bottom)),
    }
}

fn dimension(sizing: Sizing) -> Dimension {
    match sizing {
        Sizing::Fixed(value) => Dimension::length(to_f32(value)),
        Sizing::Hug | Sizing::Fill => Dimension::auto(),
    }
}

fn fixed(sizing: Sizing) -> Option<f32> {
    match sizing {
        Sizing::Fixed(value) => Some(to_f32(value)),
        Sizing::Hug | Sizing::Fill => None,
    }
}

/// A node's size and lines for the width layout offers it, in scene units.
///
/// A run whose width hugs never wraps: it breaks at hard breaks only, however
/// little room its parent has.
fn measure_text(
    segments: &BreakSegments,
    width: Sizing,
    known: Size<Option<f32>>,
    available: Size<AvailableSpace>,
) -> Size<f32> {
    if let Size {
        width: Some(width),
        height: Some(height),
    } = known
    {
        return Size { width, height };
    }

    let limit = match (width, known.width, available.width) {
        (Sizing::Hug, _, _) | (_, None, AvailableSpace::MaxContent) => f64::INFINITY,
        (_, Some(width), _) | (_, None, AvailableSpace::Definite(width)) => f64::from(width),
        (_, None, AvailableSpace::MinContent) => 0.0,
    };
    let (count, widest) = segments
        .lines(limit / segments.scale)
        .fold((0_u32, 0.0_f64), |(count, widest), line| {
            (count.saturating_add(1), widest.max(line.width))
        });
    Size {
        width: known
            .width
            .unwrap_or_else(|| to_f32(widest * segments.scale)),
        height: known
            .height
            .unwrap_or_else(|| to_f32(f64::from(count) * segments.line_height * segments.scale)),
    }
}

/// Layout input for a node sized as if alone: no size imposed, unlimited room.
fn alone(run_mode: RunMode) -> LayoutInput {
    LayoutInput {
        run_mode,
        sizing_mode: SizingMode::InherentSize,
        axis: RequestedAxis::Both,
        known_dimensions: Size::NONE,
        known_dimensions_are_definite: Size {
            width: true,
            height: true,
        },
        parent_size: Size::NONE,
        available_space: Size::MAX_CONTENT,
        vertical_margins_are_collapsible: Line::FALSE,
    }
}

/// Converts a scene value to Taffy's `f32`; a non-finite value is zero.
#[expect(
    clippy::cast_possible_truncation,
    reason = "layout runs in f32; scene coordinates lose only precision"
)]
fn to_f32(value: f64) -> f32 {
    if value.is_finite() { value as f32 } else { 0.0 }
}

impl TraversePartialTree for Engine<'_> {
    type ChildIter<'b>
        = Copied<Iter<'b, NodeId>>
    where
        Self: 'b;

    fn child_ids(&self, parent: NodeId) -> Self::ChildIter<'_> {
        self.slot(parent).flow.iter().copied()
    }

    fn child_count(&self, parent: NodeId) -> usize {
        self.slot(parent).flow.len()
    }

    fn get_child_id(&self, parent: NodeId, child_index: usize) -> NodeId {
        self.slot(parent).flow[child_index]
    }
}

impl LayoutPartialTree for Engine<'_> {
    type CoreContainerStyle<'b>
        = &'b Style
    where
        Self: 'b;

    type CustomIdent = String;

    fn get_core_container_style(&self, id: NodeId) -> Self::CoreContainerStyle<'_> {
        &self.slot(id).style
    }

    fn set_unrounded_layout(&mut self, id: NodeId, layout: &taffy::Layout) {
        let slot = self.slot_mut(id);
        slot.location = layout.location;
        slot.size = layout.size;
    }

    fn compute_child_layout(&mut self, id: NodeId, mut inputs: LayoutInput) -> LayoutOutput {
        // A hugging axis is as big as its content however much room the
        // parent offers, as in Figma; CSS would shrink it to fit.
        let slot = self.slot(id);
        if slot.width == Sizing::Hug && inputs.known_dimensions.width.is_none() {
            inputs.available_space.width = AvailableSpace::MaxContent;
        }
        if slot.height == Sizing::Hug && inputs.known_dimensions.height.is_none() {
            inputs.available_space.height = AvailableSpace::MaxContent;
        }
        compute_cached_layout(self, id, inputs, Self::compute_uncached)
    }
}

impl CacheTree for Engine<'_> {
    fn cache_get(&mut self, id: NodeId, inputs: &LayoutInput) -> Option<LayoutOutput> {
        self.slot_mut(id).cache.get(inputs)
    }

    fn cache_store(&mut self, id: NodeId, inputs: &LayoutInput, output: LayoutOutput) {
        self.slot_mut(id).cache.store(inputs, output);
    }

    fn cache_clear(&mut self, id: NodeId) {
        self.slot_mut(id).cache.clear();
    }
}

impl LayoutFlexboxContainer for Engine<'_> {
    type FlexboxContainerStyle<'b>
        = &'b Style
    where
        Self: 'b;

    type FlexboxItemStyle<'b>
        = &'b Style
    where
        Self: 'b;

    fn get_flexbox_container_style(&self, id: NodeId) -> Self::FlexboxContainerStyle<'_> {
        &self.slot(id).style
    }

    fn get_flexbox_child_style(&self, child: NodeId) -> Self::FlexboxItemStyle<'_> {
        &self.slot(child).style
    }
}
