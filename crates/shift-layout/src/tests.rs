//! Page layout through the public API.

use std::time::Instant;

use crate::{
    Align, BreakSegments, FrameLayout, Insets, Justify, LayoutError, LayoutMode, LayoutNode,
    LayoutTree, NodeKind, PageLayout, Placement, Point, Size, Sizing,
};

/// Builds a page node by node; each method returns the new node's index.
struct Page {
    tree: LayoutTree,
}

impl Page {
    fn new() -> Self {
        Self {
            tree: LayoutTree {
                nodes: vec![LayoutNode::new(None, NodeKind::Page)],
            },
        }
    }

    fn add(&mut self, parent: usize, kind: NodeKind) -> usize {
        self.tree.nodes.push(LayoutNode::new(Some(parent), kind));
        self.tree.nodes.len() - 1
    }

    fn frame(&mut self, parent: usize, layout: FrameLayout) -> usize {
        self.add(parent, NodeKind::Frame(layout))
    }

    fn leaf(&mut self, parent: usize, width: f64, height: f64) -> usize {
        self.add(parent, NodeKind::Fixed(Size::new(width, height)))
    }

    fn text(&mut self, parent: usize, segments: BreakSegments) -> usize {
        self.add(parent, NodeKind::Text(segments))
    }

    fn node(&mut self, node: usize) -> &mut LayoutNode {
        &mut self.tree.nodes[node]
    }

    fn size(&mut self, node: usize, width: Sizing, height: Sizing) {
        let node = self.node(node);
        node.width = width;
        node.height = height;
    }

    fn layout(&self) -> PageLayout {
        self.tree.layout().unwrap()
    }
}

fn row(gap: f64, padding: f64) -> FrameLayout {
    FrameLayout {
        gap,
        padding: Insets::uniform(padding),
        ..FrameLayout::stack(LayoutMode::Row)
    }
}

fn column(gap: f64, padding: f64) -> FrameLayout {
    FrameLayout {
        gap,
        padding: Insets::uniform(padding),
        ..FrameLayout::stack(LayoutMode::Column)
    }
}

/// `node`'s box as `[x, y, width, height]`.
fn rect(layout: &PageLayout, node: usize) -> [f64; 4] {
    let layout_box = layout.boxes[node];
    [
        layout_box.x,
        layout_box.y,
        layout_box.width,
        layout_box.height,
    ]
}

/// Three words of width 30, each followed by a space of 10, on lines 12
/// units apart, at scale 1.
fn three_words() -> BreakSegments {
    BreakSegments {
        widths: vec![30.0, 30.0, 30.0],
        trailing: vec![10.0, 10.0, 10.0],
        hard_breaks: vec![],
        line_height: 12.0,
        scale: 1.0,
    }
}

/// Each text run's lines as `(start, end, width)`.
fn lines(layout: &PageLayout, node: usize) -> Vec<(usize, usize, f64)> {
    layout
        .text_lines
        .iter()
        .find(|text| text.node == node)
        .unwrap()
        .lines
        .iter()
        .map(|line| (line.start, line.end, line.width))
        .collect()
}

#[test]
fn a_row_places_children_after_its_padding_with_gaps_between() {
    let mut page = Page::new();
    let frame = page.frame(0, row(5.0, 10.0));
    let a = page.leaf(frame, 20.0, 10.0);
    let b = page.leaf(frame, 30.0, 20.0);
    let c = page.leaf(frame, 10.0, 10.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, a), [10.0, 10.0, 20.0, 10.0]);
    assert_eq!(rect(&layout, b), [35.0, 10.0, 30.0, 20.0]);
    assert_eq!(rect(&layout, c), [70.0, 10.0, 10.0, 10.0]);
    assert_eq!(rect(&layout, frame), [0.0, 0.0, 90.0, 40.0]);
}

#[test]
fn a_column_places_children_after_its_padding_with_gaps_between() {
    let mut page = Page::new();
    let frame = page.frame(0, column(5.0, 10.0));
    let a = page.leaf(frame, 20.0, 10.0);
    let b = page.leaf(frame, 30.0, 20.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, a), [10.0, 10.0, 20.0, 10.0]);
    assert_eq!(rect(&layout, b), [10.0, 25.0, 30.0, 20.0]);
    assert_eq!(rect(&layout, frame), [0.0, 0.0, 50.0, 55.0]);
}

#[test]
fn a_fixed_frame_keeps_its_size_whatever_its_children() {
    let mut page = Page::new();
    let frame = page.frame(0, row(0.0, 0.0));
    page.size(frame, Sizing::Fixed(200.0), Sizing::Fixed(15.0));
    page.leaf(frame, 20.0, 40.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, frame), [0.0, 0.0, 200.0, 15.0]);
}

#[test]
fn fill_along_the_main_axis_shares_the_room_left() {
    let mut page = Page::new();
    let frame = page.frame(0, row(10.0, 0.0));
    page.size(frame, Sizing::Fixed(200.0), Sizing::Hug);
    let fixed = page.leaf(frame, 50.0, 10.0);
    let first = page.leaf(frame, 5.0, 10.0);
    let second = page.leaf(frame, 5.0, 10.0);
    page.size(first, Sizing::Fill, Sizing::Hug);
    page.size(second, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    // 200 - 50 - 2 gaps of 10 = 130, shared equally.
    assert_eq!(rect(&layout, fixed), [0.0, 0.0, 50.0, 10.0]);
    assert_eq!(rect(&layout, first), [60.0, 0.0, 65.0, 10.0]);
    assert_eq!(rect(&layout, second), [135.0, 0.0, 65.0, 10.0]);
}

#[test]
fn fill_across_the_main_axis_stretches_to_the_inner_size() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 10.0));
    page.size(frame, Sizing::Fixed(120.0), Sizing::Hug);
    let filled = page.leaf(frame, 5.0, 10.0);
    let hugging = page.leaf(frame, 5.0, 10.0);
    page.size(filled, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, filled), [10.0, 10.0, 100.0, 10.0]);
    assert_eq!(rect(&layout, hugging), [10.0, 20.0, 5.0, 10.0]);
}

#[test]
fn fill_in_a_hugging_frame_takes_the_size_of_its_widest_sibling() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 0.0));
    let filled = page.leaf(frame, 5.0, 10.0);
    page.leaf(frame, 80.0, 10.0);
    page.size(filled, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, filled)[2], 80.0);
    assert_eq!(rect(&layout, frame)[2], 80.0);
}

#[test]
fn fill_outside_a_row_or_column_hugs() {
    let mut page = Page::new();
    let free = page.frame(0, FrameLayout::FREE);
    let in_free = page.leaf(free, 30.0, 20.0);
    page.size(in_free, Sizing::Fill, Sizing::Fill);
    let on_page = page.leaf(0, 40.0, 10.0);
    page.size(on_page, Sizing::Fill, Sizing::Fill);
    let stack = page.frame(0, row(0.0, 0.0));
    page.size(stack, Sizing::Fixed(300.0), Sizing::Fixed(300.0));
    let absolute = page.leaf(stack, 25.0, 15.0);
    page.size(absolute, Sizing::Fill, Sizing::Fill);
    page.node(absolute).placement = Placement::Absolute;

    let layout = page.layout();

    assert_eq!(rect(&layout, in_free)[2..], [30.0, 20.0]);
    assert_eq!(rect(&layout, on_page)[2..], [40.0, 10.0]);
    assert_eq!(rect(&layout, absolute)[2..], [25.0, 15.0]);
}

#[test]
fn hugging_children_keep_their_size_in_a_parent_too_small_for_them() {
    let mut page = Page::new();
    let frame = page.frame(0, row(0.0, 0.0));
    page.size(frame, Sizing::Fixed(50.0), Sizing::Hug);
    let a = page.leaf(frame, 40.0, 10.0);
    let b = page.leaf(frame, 40.0, 10.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, a), [0.0, 0.0, 40.0, 10.0]);
    assert_eq!(rect(&layout, b), [40.0, 0.0, 40.0, 10.0]);
}

#[test]
fn a_hugging_row_is_as_wide_as_its_children_in_a_narrower_column() {
    let mut page = Page::new();
    let outer = page.frame(0, column(0.0, 0.0));
    page.size(outer, Sizing::Fixed(50.0), Sizing::Hug);
    // Wrapping, the row could fit in 50 on two lines; hugging, it doesn't.
    let inner = page.frame(
        outer,
        FrameLayout {
            wrap: true,
            ..row(0.0, 0.0)
        },
    );
    page.leaf(inner, 40.0, 10.0);
    page.leaf(inner, 40.0, 10.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, inner), [0.0, 0.0, 80.0, 10.0]);
}

#[test]
fn a_hugging_column_is_as_tall_as_its_children_in_a_shorter_row() {
    let mut page = Page::new();
    let outer = page.frame(0, row(0.0, 0.0));
    page.size(outer, Sizing::Hug, Sizing::Fixed(50.0));
    let inner = page.frame(
        outer,
        FrameLayout {
            wrap: true,
            ..column(0.0, 0.0)
        },
    );
    page.leaf(inner, 10.0, 40.0);
    page.leaf(inner, 10.0, 40.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, inner), [0.0, 0.0, 10.0, 80.0]);
}

/// A 100 by 100 row with two 20 by 20 leaves, justified and aligned.
fn justified(justify: Justify, align: Align) -> [[f64; 4]; 2] {
    let mut page = Page::new();
    let frame = page.frame(
        0,
        FrameLayout {
            justify,
            align,
            ..row(0.0, 0.0)
        },
    );
    page.size(frame, Sizing::Fixed(100.0), Sizing::Fixed(100.0));
    let a = page.leaf(frame, 20.0, 20.0);
    let b = page.leaf(frame, 20.0, 20.0);
    let layout = page.layout();
    [rect(&layout, a), rect(&layout, b)]
}

#[test]
fn justify_distributes_children_along_the_main_axis() {
    let x = |boxes: [[f64; 4]; 2]| [boxes[0][0], boxes[1][0]];

    assert_eq!(x(justified(Justify::Start, Align::Start)), [0.0, 20.0]);
    assert_eq!(x(justified(Justify::Center, Align::Start)), [30.0, 50.0]);
    assert_eq!(x(justified(Justify::End, Align::Start)), [60.0, 80.0]);
    assert_eq!(
        x(justified(Justify::SpaceBetween, Align::Start)),
        [0.0, 80.0]
    );
}

#[test]
fn align_places_children_across_the_main_axis() {
    let y = |boxes: [[f64; 4]; 2]| boxes[0][1];

    assert_eq!(y(justified(Justify::Start, Align::Start)), 0.0);
    assert_eq!(y(justified(Justify::Start, Align::Center)), 40.0);
    assert_eq!(y(justified(Justify::Start, Align::End)), 80.0);
}

#[test]
fn baseline_alignment_lines_up_the_bottom_edges_of_leaves() {
    let mut page = Page::new();
    let frame = page.frame(
        0,
        FrameLayout {
            align: Align::Baseline,
            ..row(0.0, 0.0)
        },
    );
    let short = page.leaf(frame, 10.0, 10.0);
    let tall = page.leaf(frame, 10.0, 30.0);

    let layout = page.layout();

    assert_eq!(
        rect(&layout, short)[1] + 10.0,
        rect(&layout, tall)[1] + 30.0
    );
}

#[test]
fn a_wrapping_row_starts_a_new_line_when_children_run_out_of_room() {
    let mut page = Page::new();
    let frame = page.frame(
        0,
        FrameLayout {
            wrap: true,
            ..row(10.0, 0.0)
        },
    );
    page.size(frame, Sizing::Fixed(100.0), Sizing::Hug);
    let a = page.leaf(frame, 40.0, 10.0);
    let b = page.leaf(frame, 40.0, 10.0);
    let c = page.leaf(frame, 40.0, 10.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, a), [0.0, 0.0, 40.0, 10.0]);
    assert_eq!(rect(&layout, b), [50.0, 0.0, 40.0, 10.0]);
    assert_eq!(rect(&layout, c), [0.0, 20.0, 40.0, 10.0]);
    assert_eq!(rect(&layout, frame)[3], 30.0);
}

#[test]
fn an_absolute_child_keeps_its_position_and_takes_no_room() {
    let mut page = Page::new();
    let frame = page.frame(0, row(10.0, 5.0));
    let absolute = page.leaf(frame, 30.0, 30.0);
    page.node(absolute).placement = Placement::Absolute;
    page.node(absolute).position = Point::new(100.0, -20.0);
    let auto = page.leaf(frame, 20.0, 20.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, absolute), [100.0, -20.0, 30.0, 30.0]);
    assert_eq!(rect(&layout, auto), [5.0, 5.0, 20.0, 20.0]);
    assert_eq!(rect(&layout, frame), [0.0, 0.0, 30.0, 30.0]);
}

#[test]
fn a_free_frame_keeps_its_children_where_they_are_and_hugs_them() {
    let mut page = Page::new();
    let frame = page.frame(0, FrameLayout::FREE);
    page.node(frame).position = Point::new(10.0, 10.0);
    let a = page.leaf(frame, 10.0, 10.0);
    page.node(a).position = Point::new(5.0, 5.0);
    let b = page.leaf(frame, 10.0, 10.0);
    page.node(b).position = Point::new(20.0, 30.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, a), [5.0, 5.0, 10.0, 10.0]);
    assert_eq!(rect(&layout, b), [20.0, 30.0, 10.0, 10.0]);
    // From the frame's origin to its children's far edges.
    assert_eq!(rect(&layout, frame), [10.0, 10.0, 30.0, 40.0]);
}

#[test]
fn a_fixed_free_frame_keeps_its_size() {
    let mut page = Page::new();
    let frame = page.frame(0, FrameLayout::FREE);
    page.size(frame, Sizing::Fixed(50.0), Sizing::Hug);
    let leaf = page.leaf(frame, 10.0, 10.0);
    page.node(leaf).position = Point::new(80.0, 0.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, frame), [0.0, 0.0, 50.0, 10.0]);
}

#[test]
fn the_page_hugs_its_children_at_their_positions() {
    let mut page = Page::new();
    let a = page.leaf(0, 10.0, 10.0);
    page.node(a).position = Point::new(100.0, 50.0);
    let b = page.leaf(0, 10.0, 10.0);
    page.node(b).position = Point::new(-30.0, 0.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, a), [100.0, 50.0, 10.0, 10.0]);
    assert_eq!(rect(&layout, b), [-30.0, 0.0, 10.0, 10.0]);
    assert_eq!(rect(&layout, 0), [0.0, 0.0, 110.0, 60.0]);
}

#[test]
fn frames_nest() {
    let mut page = Page::new();
    let outer = page.frame(0, column(10.0, 10.0));
    page.size(outer, Sizing::Fixed(200.0), Sizing::Hug);
    page.node(outer).position = Point::new(50.0, 50.0);
    let header = page.leaf(outer, 30.0, 20.0);
    let inner = page.frame(
        outer,
        FrameLayout {
            justify: Justify::End,
            ..row(0.0, 0.0)
        },
    );
    page.size(inner, Sizing::Fill, Sizing::Hug);
    let leaf = page.leaf(inner, 20.0, 15.0);

    let layout = page.layout();

    assert_eq!(rect(&layout, header), [10.0, 10.0, 30.0, 20.0]);
    assert_eq!(rect(&layout, inner), [10.0, 40.0, 180.0, 15.0]);
    assert_eq!(rect(&layout, leaf), [160.0, 0.0, 20.0, 15.0]);
    assert_eq!(rect(&layout, outer), [50.0, 50.0, 200.0, 65.0]);
}

#[test]
fn a_text_run_of_fixed_width_wraps_inside_it() {
    let mut page = Page::new();
    let text = page.text(0, three_words());
    page.size(text, Sizing::Fixed(75.0), Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [0.0, 0.0, 75.0, 24.0]);
    assert_eq!(lines(&layout, text), [(0, 2, 70.0), (2, 3, 30.0)]);
}

#[test]
fn a_hugging_text_run_is_one_line_per_paragraph() {
    let mut page = Page::new();
    let text = page.text(0, three_words());

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [0.0, 0.0, 110.0, 12.0]);
    assert_eq!(lines(&layout, text), [(0, 3, 110.0)]);
}

#[test]
fn a_hugging_text_run_does_not_wrap_in_a_narrow_frame() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 0.0));
    page.size(frame, Sizing::Fixed(50.0), Sizing::Hug);
    let text = page.text(frame, three_words());

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[2..], [110.0, 12.0]);
    assert_eq!(lines(&layout, text).len(), 1);
}

#[test]
fn a_filling_text_run_wraps_at_the_room_its_parent_leaves() {
    let mut page = Page::new();
    let frame = page.frame(0, row(10.0, 0.0));
    page.size(frame, Sizing::Fixed(130.0), Sizing::Hug);
    page.leaf(frame, 40.0, 5.0);
    let text = page.text(frame, three_words());
    page.size(text, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [50.0, 0.0, 80.0, 24.0]);
    assert_eq!(lines(&layout, text), [(0, 2, 70.0), (2, 3, 30.0)]);
    assert_eq!(rect(&layout, frame)[3], 24.0);
}

#[test]
fn a_text_run_stretched_across_a_column_wraps_at_its_inner_width() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 5.0));
    page.size(frame, Sizing::Fixed(60.0), Sizing::Hug);
    let text = page.text(frame, three_words());
    page.size(text, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [5.0, 5.0, 50.0, 36.0]);
    assert_eq!(lines(&layout, text).len(), 3);
    assert_eq!(rect(&layout, frame)[3], 46.0);
}

#[test]
fn a_text_run_scales_its_units_to_scene_units() {
    let mut page = Page::new();
    let text = page.text(
        0,
        BreakSegments {
            scale: 0.5,
            ..three_words()
        },
    );
    page.size(text, Sizing::Fixed(37.5), Sizing::Hug);

    let layout = page.layout();

    // 75 run units wide, so the same lines as at scale 1 and width 75.
    assert_eq!(rect(&layout, text)[2..], [37.5, 12.0]);
    assert_eq!(lines(&layout, text), [(0, 2, 70.0), (2, 3, 30.0)]);
}

#[test]
fn a_text_run_breaks_at_its_hard_breaks() {
    let mut page = Page::new();
    let text = page.text(
        0,
        BreakSegments {
            hard_breaks: vec![0],
            ..three_words()
        },
    );

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[2..], [70.0, 24.0]);
    assert_eq!(lines(&layout, text), [(0, 1, 30.0), (1, 3, 70.0)]);
}

#[test]
fn an_empty_text_run_is_one_empty_line_tall() {
    let mut page = Page::new();
    let text = page.text(
        0,
        BreakSegments {
            widths: vec![],
            trailing: vec![],
            ..three_words()
        },
    );

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[2..], [0.0, 12.0]);
    assert_eq!(lines(&layout, text), [(0, 0, 0.0)]);
}

#[test]
fn a_text_run_hugs_its_lines_whatever_its_height_sizing() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 0.0));
    page.size(frame, Sizing::Fixed(100.0), Sizing::Fixed(300.0));
    let text = page.text(frame, three_words());
    page.size(text, Sizing::Hug, Sizing::Fill);
    let fixed = page.text(frame, three_words());
    page.size(fixed, Sizing::Hug, Sizing::Fixed(100.0));

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[3], 12.0);
    assert_eq!(rect(&layout, fixed)[3], 12.0);
}

#[test]
fn text_lines_list_every_text_run_in_input_order() {
    let mut page = Page::new();
    let first = page.text(0, three_words());
    page.leaf(0, 10.0, 10.0);
    let second = page.text(0, three_words());

    let layout = page.layout();

    let nodes: Vec<usize> = layout.text_lines.iter().map(|text| text.node).collect();
    assert_eq!(nodes, [first, second]);
    assert_eq!(layout.boxes.len(), 4);
}

#[test]
fn the_same_tree_lays_out_the_same_every_time() {
    let page = waterfall(50);

    assert_eq!(page.layout(), page.layout());
}

#[test]
fn malformed_trees_are_rejected() {
    let page_node = || LayoutNode::new(None, NodeKind::Page);
    let leaf = |parent| LayoutNode::new(parent, NodeKind::Fixed(Size::ZERO));
    let error = |nodes: Vec<LayoutNode>| LayoutTree { nodes }.layout().unwrap_err();

    assert_eq!(error(vec![]), LayoutError::Empty);
    assert_eq!(error(vec![leaf(None)]), LayoutError::RootNotPage);
    assert_eq!(
        error(vec![page_node(), leaf(None)]),
        LayoutError::SecondRoot { node: 1 }
    );
    assert_eq!(
        error(vec![page_node(), page_node()]),
        LayoutError::NestedPage { node: 1 }
    );
    assert_eq!(
        error(vec![page_node(), leaf(Some(1))]),
        LayoutError::ParentNotBefore { node: 1, parent: 1 }
    );
    assert_eq!(
        error(vec![page_node(), leaf(Some(0)), leaf(Some(1))]),
        LayoutError::ParentIsLeaf { node: 2, parent: 1 }
    );
    let text = LayoutNode::new(
        Some(0),
        NodeKind::Text(BreakSegments {
            scale: 0.0,
            ..three_words()
        }),
    );
    assert_eq!(
        error(vec![page_node(), text]),
        LayoutError::InvalidScale {
            node: 1,
            scale: 0.0
        }
    );
}

/// A page of `sections` waterfalls side by side: each a column of 16 filling
/// text runs of 40 words at growing sizes, and four fixed leaves.
fn waterfall(sections: u32) -> Page {
    let mut page = Page::new();
    let row = page.frame(
        0,
        FrameLayout {
            wrap: true,
            ..row(24.0, 32.0)
        },
    );
    page.size(row, Sizing::Fixed(4000.0), Sizing::Hug);
    for section in 0..sections {
        let column = page.frame(row, column(12.0, 16.0));
        page.size(column, Sizing::Fixed(600.0), Sizing::Hug);
        for size in 0..16 {
            let words = (0..40_u32)
                .map(|word| f64::from((word * 7 + section) % 11) * 60.0 + 200.0)
                .collect::<Vec<_>>();
            let text = page.text(
                column,
                BreakSegments {
                    trailing: vec![250.0; words.len()],
                    widths: words,
                    hard_breaks: vec![19],
                    line_height: 1200.0,
                    scale: f64::from(12 + size * 4) / 1000.0,
                },
            );
            page.size(text, Sizing::Fill, Sizing::Hug);
        }
        for _ in 0..4 {
            page.leaf(column, 120.0, 80.0);
        }
    }
    page
}

/// Times a layout of about 1,000 leaves. Run with
/// `cargo test --release -p shift-layout -- --ignored --nocapture`.
#[test]
#[ignore = "timing; run in release"]
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a quantile's index into the samples"
)]
fn time_a_thousand_leaves() {
    let page = waterfall(50);
    let leaves = page
        .tree
        .nodes
        .iter()
        .filter(|node| matches!(node.kind, NodeKind::Text(_) | NodeKind::Fixed(_)))
        .count();

    let mut samples = (0..200)
        .map(|_| {
            let started = Instant::now();
            let layout = page.layout();
            let elapsed = started.elapsed();
            assert_eq!(layout.boxes.len(), page.tree.nodes.len());
            elapsed.as_secs_f64() * 1000.0
        })
        .collect::<Vec<_>>();
    samples.sort_by(f64::total_cmp);
    let at = |quantile: f64| samples[((samples.len() - 1) as f64 * quantile).round() as usize];

    println!(
        "{leaves} leaves, {} nodes: p50 {:.3} ms, p95 {:.3} ms",
        page.tree.nodes.len(),
        at(0.5),
        at(0.95)
    );
}
