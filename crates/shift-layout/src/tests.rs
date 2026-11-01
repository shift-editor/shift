//! Page layout through the public API, with text measured as the engine
//! measures it: laid out by shift-text, here over a font known by its
//! advances.

use std::collections::BTreeMap;
use std::time::Instant;

use shift_font::GlyphId;
use shift_text::layout::{
    CharacterGlyph, LayoutFont, LayoutRequest, LayoutUnit, LineMetrics, TextLayout, TextMeasure,
    TextOptions, TextSize, TypedFont, TypedGlyph,
};

use crate::{
    Align, BoxSizing, FrameLayout, Insets, Justify, LayoutDirection, LayoutError, LayoutNode,
    LayoutTree, MeasureText, NodeKind, PageLayout, Placement, Point, Size, Sizing,
};

/// A font where `a` and the space are 10 units wide, on lines 12 units
/// apart (an ascender of 9 and a descender of 3).
fn font() -> TypedFont {
    let [letter, space] = [GlyphId::new(), GlyphId::new()];
    let glyph = |glyph_id, advance| TypedGlyph {
        glyph_id,
        advance,
        is_mark: false,
    };
    let character = |character: char, glyph_id| CharacterGlyph {
        codepoint: u32::from(character),
        glyph_id,
    };
    TypedFont {
        characters: vec![character('a', letter), character(' ', space)],
        glyphs: vec![glyph(letter, 10.0), glyph(space, 10.0)],
        metrics: LineMetrics {
            units_per_em: 1000.0,
            ascender: 9.0,
            descender: -3.0,
            line_gap: 0.0,
            cap_height: None,
        },
    }
}

/// One text run: its text, a newline between paragraphs, and how many
/// scene units one of its font units spans.
struct Run {
    units: Vec<LayoutUnit>,
    scale: f64,
}

/// Measures text runs as the engine does, by laying them out with
/// shift-text, keeping each layout per node and width.
struct Texts {
    font: TypedFont,
    runs: BTreeMap<usize, Run>,
    laid_out: BTreeMap<(usize, Option<u64>), TextLayout>,
    /// Each run shaped once, and its size at each width, as the engine keeps
    /// them.
    shaped: BTreeMap<usize, TextMeasure>,
    sizes: BTreeMap<(usize, Option<u64>), TextSize>,
}

impl Texts {
    fn new(font: TypedFont) -> Self {
        Self {
            font,
            runs: BTreeMap::new(),
            laid_out: BTreeMap::new(),
            shaped: BTreeMap::new(),
            sizes: BTreeMap::new(),
        }
    }

    /// Forgets every run's shaped text and sizes, as a font change does.
    fn forget(&mut self) {
        self.shaped.clear();
        self.sizes.clear();
    }

    /// A width in scene units as run `node`'s font units; shift-text reads
    /// a width of 0 as none, so the narrowest positive one breaks at every
    /// chance.
    fn font_width(&self, node: usize, width: Option<f64>) -> Option<f64> {
        let scale = self.runs[&node].scale;
        width.map(|width| (width / scale).max(f64::MIN_POSITIVE))
    }

    fn request(&self, node: usize, width: Option<f64>) -> LayoutRequest {
        LayoutRequest {
            units: self.runs[&node].units.clone(),
            options: TextOptions {
                shaping: false,
                width: self.font_width(node, width),
                ..TextOptions::default()
            },
        }
    }

    /// Run `node` laid out with lines no wider than `width` scene units.
    fn layout(&mut self, node: usize, width: Option<f64>) -> &TextLayout {
        let request = self.request(node, width);
        let font = &self.font;
        self.laid_out
            .entry((node, width.map(f64::to_bits)))
            .or_insert_with(|| TextLayout::new(&LayoutFont::typed(font), &request).unwrap())
    }
}

impl MeasureText for Texts {
    fn measure(&mut self, node: usize, width: Option<f64>) -> Size {
        let scale = self.runs[&node].scale;
        let font_width = self.font_width(node, width);
        let font = LayoutFont::typed(&self.font);
        if !self.shaped.contains_key(&node) {
            let shaped = TextMeasure::new(&font, &self.request(node, None)).unwrap();
            self.shaped.insert(node, shaped);
        }
        let shaped = &self.shaped[&node];
        let size = *self
            .sizes
            .entry((node, width.map(f64::to_bits)))
            .or_insert_with(|| shaped.size(&font, font_width));
        Size::new(
            size.width * scale,
            f64::from(size.lines) * size.line_height * scale,
        )
    }
}

/// Builds a page node by node; each method returns the new node's index.
struct Page {
    tree: LayoutTree,
    texts: Texts,
}

impl Page {
    fn new() -> Self {
        Self {
            tree: LayoutTree {
                nodes: vec![LayoutNode::new(None, NodeKind::Page)],
            },
            texts: Texts::new(font()),
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

    /// A text run of `text` at `scale`.
    fn text_at(&mut self, parent: usize, text: &str, scale: f64) -> usize {
        let node = self.add(parent, NodeKind::Text);
        let units = text
            .chars()
            .map(|character| match character {
                '\n' => LayoutUnit::LineBreak,
                _ => LayoutUnit::Character {
                    codepoint: u32::from(character),
                },
            })
            .collect();
        self.texts.runs.insert(node, Run { units, scale });
        node
    }

    fn text(&mut self, parent: usize, text: &str) -> usize {
        self.text_at(parent, text, 1.0)
    }

    fn node(&mut self, node: usize) -> &mut LayoutNode {
        &mut self.tree.nodes[node]
    }

    fn size(&mut self, node: usize, width: Sizing, height: Sizing) {
        self.node(node).sizing = BoxSizing::new(width, height);
    }

    fn layout(&mut self) -> PageLayout {
        self.tree.layout(&mut self.texts).unwrap()
    }

    /// Text run `node`'s lines at the width `layout` gave it, as the units
    /// each covers, from `start` up to `end`.
    fn lines(&mut self, layout: &PageLayout, node: usize) -> Vec<(u32, u32)> {
        let width = layout
            .text_widths
            .iter()
            .find(|text| text.node == node)
            .unwrap()
            .width;
        self.texts
            .layout(node, width)
            .lines
            .iter()
            .map(|line| (line.start, line.end))
            .collect()
    }
}

fn row(gap: f64, padding: f64) -> FrameLayout {
    FrameLayout {
        gap,
        padding: Insets::uniform(padding),
        ..FrameLayout::stack(LayoutDirection::Row)
    }
}

fn column(gap: f64, padding: f64) -> FrameLayout {
    FrameLayout {
        gap,
        padding: Insets::uniform(padding),
        ..FrameLayout::stack(LayoutDirection::Column)
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

/// Three words of 30 units, a space of 10 after each of the first two.
const THREE_WORDS: &str = "aaa aaa aaa";

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
    let text = page.text(0, THREE_WORDS);
    page.size(text, Sizing::Fixed(75.0), Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [0.0, 0.0, 75.0, 24.0]);
    assert_eq!(page.lines(&layout, text), [(0, 8), (8, 11)]);
}

#[test]
fn a_hugging_text_run_is_one_line_per_paragraph() {
    let mut page = Page::new();
    let text = page.text(0, THREE_WORDS);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [0.0, 0.0, 110.0, 12.0]);
    assert_eq!(page.lines(&layout, text), [(0, 11)]);
}

#[test]
fn a_hugging_text_run_does_not_wrap_in_a_narrow_frame() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 0.0));
    page.size(frame, Sizing::Fixed(50.0), Sizing::Hug);
    let text = page.text(frame, THREE_WORDS);

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[2..], [110.0, 12.0]);
    assert_eq!(page.lines(&layout, text).len(), 1);
}

#[test]
fn a_filling_text_run_wraps_at_the_room_its_parent_leaves() {
    let mut page = Page::new();
    let frame = page.frame(0, row(10.0, 0.0));
    page.size(frame, Sizing::Fixed(130.0), Sizing::Hug);
    page.leaf(frame, 40.0, 5.0);
    let text = page.text(frame, THREE_WORDS);
    page.size(text, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [50.0, 0.0, 80.0, 24.0]);
    assert_eq!(page.lines(&layout, text), [(0, 8), (8, 11)]);
    assert_eq!(rect(&layout, frame)[3], 24.0);
}

#[test]
fn a_text_run_stretched_across_a_column_wraps_at_its_inner_width() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 5.0));
    page.size(frame, Sizing::Fixed(60.0), Sizing::Hug);
    let text = page.text(frame, THREE_WORDS);
    page.size(text, Sizing::Fill, Sizing::Hug);

    let layout = page.layout();

    assert_eq!(rect(&layout, text), [5.0, 5.0, 50.0, 36.0]);
    assert_eq!(page.lines(&layout, text).len(), 3);
    assert_eq!(rect(&layout, frame)[3], 46.0);
}

#[test]
fn a_filling_text_run_in_a_hugging_column_keeps_its_one_line() {
    // The column hugs the run's width, which comes back to the run through
    // layout's f32 as the width its lines break at.
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 0.0));
    let text = page.text_at(frame, THREE_WORDS, 0.1);
    page.size(text, Sizing::Fill, Sizing::Hug);
    page.leaf(frame, 1.0, 1.0);

    let layout = page.layout();

    assert_eq!(page.lines(&layout, text).len(), 1);
}

#[test]
fn a_text_run_scales_its_units_to_scene_units() {
    let mut page = Page::new();
    let text = page.text_at(0, THREE_WORDS, 0.5);
    page.size(text, Sizing::Fixed(37.5), Sizing::Hug);

    let layout = page.layout();

    // 75 font units wide, so the same lines as at scale 1 and width 75.
    assert_eq!(rect(&layout, text)[2..], [37.5, 12.0]);
    assert_eq!(page.lines(&layout, text), [(0, 8), (8, 11)]);
}

#[test]
fn a_text_run_breaks_between_its_paragraphs() {
    let mut page = Page::new();
    let text = page.text(0, "aaa\naaa aaa");

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[2..], [70.0, 24.0]);
    assert_eq!(page.lines(&layout, text), [(0, 4), (4, 11)]);
}

#[test]
fn a_text_run_hugs_its_lines_whatever_its_height_sizing() {
    let mut page = Page::new();
    let frame = page.frame(0, column(0.0, 0.0));
    page.size(frame, Sizing::Fixed(200.0), Sizing::Fixed(300.0));
    let text = page.text(frame, THREE_WORDS);
    page.size(text, Sizing::Hug, Sizing::Fill);
    let fixed = page.text(frame, THREE_WORDS);
    page.size(fixed, Sizing::Hug, Sizing::Fixed(100.0));

    let layout = page.layout();

    assert_eq!(rect(&layout, text)[3], 12.0);
    assert_eq!(rect(&layout, fixed)[3], 12.0);
}

#[test]
fn text_widths_list_every_text_run_in_input_order() {
    let mut page = Page::new();
    let first = page.text(0, THREE_WORDS);
    page.leaf(0, 10.0, 10.0);
    let second = page.text(0, THREE_WORDS);
    page.size(second, Sizing::Fixed(75.0), Sizing::Hug);

    let layout = page.layout();

    let widths: Vec<(usize, Option<f64>)> = layout
        .text_widths
        .iter()
        .map(|text| (text.node, text.width))
        .collect();
    assert_eq!(widths, [(first, None), (second, Some(75.0))]);
    assert_eq!(layout.boxes.len(), 4);
}

#[test]
fn the_same_tree_lays_out_the_same_every_time() {
    let mut page = waterfall(50);

    assert_eq!(page.layout(), page.layout());
}

#[test]
fn malformed_trees_are_rejected() {
    let page_node = || LayoutNode::new(None, NodeKind::Page);
    let leaf = |parent| LayoutNode::new(parent, NodeKind::Fixed(Size::ZERO));
    let error = |nodes: Vec<LayoutNode>| {
        LayoutTree { nodes }
            .layout(&mut Texts::new(font()))
            .unwrap_err()
    };

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
}

/// Forty words of 4 to 14 letters, a paragraph break after the twentieth.
fn forty_words(section: u32) -> String {
    let words: Vec<String> = (0..40_u32)
        .map(|word| "a".repeat(((word * 7 + section) % 11 + 4) as usize))
        .collect();
    format!("{}\n{}", words[..20].join(" "), words[20..].join(" "))
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
            let text = page.text_at(
                column,
                &forty_words(section),
                f64::from(12 + size * 4) / 200.0,
            );
            page.size(text, Sizing::Fill, Sizing::Hug);
        }
        for _ in 0..4 {
            page.leaf(column, 120.0, 80.0);
        }
    }
    page
}

/// Times a layout of about 1,000 leaves, text laid out by shift-text. Run with
/// `cargo test --release -p shift-layout -- --ignored --nocapture`.
#[test]
#[ignore = "timing; run in release"]
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "a quantile's index into the samples"
)]
fn time_a_thousand_leaves() {
    let mut page = waterfall(50);
    let leaves = page
        .tree
        .nodes
        .iter()
        .filter(|node| matches!(node.kind, NodeKind::Text | NodeKind::Fixed(_)))
        .count();

    let mut time = |fresh_text: bool| {
        let mut samples = (0..50)
            .map(|_| {
                if fresh_text {
                    page.texts.forget();
                }
                let started = Instant::now();
                let layout = page.layout();
                let elapsed = started.elapsed();
                assert_eq!(layout.boxes.len(), page.tree.nodes.len());
                elapsed.as_secs_f64() * 1000.0
            })
            .collect::<Vec<_>>();
        samples.sort_by(f64::total_cmp);
        let at = |quantile: f64| samples[((samples.len() - 1) as f64 * quantile).round() as usize];
        (at(0.5), at(0.95))
    };
    // Laid out after a font change, every run is shaped and measured again;
    // laid out again with nothing changed, as the engine keeps runs, only
    // the layout itself is left.
    let fresh = time(true);
    let measured = time(false);

    println!(
        "{leaves} leaves, {} nodes: p50 {:.3} ms, p95 {:.3} ms with every run shaped; \
         p50 {:.3} ms, p95 {:.3} ms with runs kept",
        page.tree.nodes.len(),
        fresh.0,
        fresh.1,
        measured.0,
        measured.1
    );
}
