//! Page layout in the editor: shift-layout over one page's tree, in one call.
//!
//! The export exists only with the `layout` feature, which `shaping` turns
//! on, so it ships in `@shift/wasm/shaping`: a page is laid out after its text
//! is shaped, so the module is already loaded. The layouts below are declared
//! either way, so the editor's side generates without the feature.
//!
//! The editor sends the whole tree, text runs already measured into break
//! segments, and gets every box and every text run's lines back; nothing
//! calls back into JavaScript while layout runs.

use crate::layout::{enum_layout, layout};

/// A layout node's kind.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LayoutNodeKind {
    #[default]
    Page,
    Frame,
    Text,
    Fixed,
}

enum_layout! {
    /// What a layout node is: the page (first, and only first), a frame, a text run, or a leaf of fixed size.
    LayoutNodeKind {
        Page => "page",
        Frame => "frame",
        Text => "text",
        Fixed => "fixed",
    }
}

/// One axis's size rule, without its size.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LayoutSizingMode {
    Fixed,
    #[default]
    Hug,
    Fill,
}

enum_layout! {
    /// One axis's size rule: `fixed` at its size, `hug` the content, or `fill` the parent row or column.
    LayoutSizingMode {
        Fixed => "fixed",
        Hug => "hug",
        Fill => "fill",
    }
}

/// Whether a child of a row or column follows its layout.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LayoutPlacement {
    #[default]
    Auto,
    Absolute,
}

enum_layout! {
    /// Whether a child of a row or column follows its layout (`auto`) or keeps its position (`absolute`).
    LayoutPlacement {
        Auto => "auto",
        Absolute => "absolute",
    }
}

/// A frame's layout mode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LayoutFrameMode {
    #[default]
    Free,
    Row,
    Column,
}

enum_layout! {
    /// How a frame places its children.
    LayoutFrameMode {
        Free => "free",
        Row => "row",
        Column => "column",
    }
}

/// Where a row or column's children sit across its main axis.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LayoutAlign {
    #[default]
    Start,
    Center,
    End,
    Baseline,
}

enum_layout! {
    /// Where a row or column's children sit across its main axis.
    LayoutAlign {
        Start => "start",
        Center => "center",
        End => "end",
        Baseline => "baseline",
    }
}

/// How a row or column's children share its main axis.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LayoutJustify {
    #[default]
    Start,
    Center,
    End,
    SpaceBetween,
}

enum_layout! {
    /// How a row or column's children share its main axis.
    LayoutJustify {
        Start => "start",
        Center => "center",
        End => "end",
        SpaceBetween => "space-between",
    }
}

layout! {
    /// One axis's size rule.
    pub struct LayoutSizing {
        pub mode: LayoutSizingMode,
        /// The size in scene units, for `fixed`.
        pub size: f64,
    }
}

layout! {
    /// Space inside a frame's edges, scene units.
    pub struct LayoutInsets {
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
        pub left: f64,
    }
}

layout! {
    /// How a frame places its children; gap, padding, align, justify, and wrap apply to rows and columns.
    pub struct LayoutFrameInput {
        pub mode: LayoutFrameMode,
        /// Space between neighbouring children and between wrapped lines, scene units.
        pub gap: f64,
        pub padding: LayoutInsets,
        pub align: LayoutAlign,
        pub justify: LayoutJustify,
        pub wrap: bool,
    }
}

layout! {
    /// A text run measured into break segments, in its own units.
    pub struct LayoutTextInput {
        /// Width of each unbreakable segment, without the space after it.
        pub widths: Vec<f64>,
        /// Width of the space after each segment, dropped where a line ends.
        pub trailing: Vec<f64>,
        /// Segments after which a line must end, ascending.
        pub hard_breaks: Vec<usize>,
        /// Distance between baselines.
        pub line_height: f64,
        /// Scene units per run unit: the node's size over units per em.
        pub scale: f64,
    }
}

layout! {
    /// A size in scene units.
    pub struct LayoutSizeInput {
        pub width: f64,
        pub height: f64,
    }
}

layout! {
    /// One node of a page's layout tree.
    pub struct LayoutNodeInput {
        /// The parent's index in `nodes`, before this node; null for the page.
        pub parent: Option<usize>,
        pub kind: LayoutNodeKind,
        pub width: LayoutSizing,
        /// Ignored for text runs, whose height hugs their lines.
        pub height: LayoutSizing,
        pub placement: LayoutPlacement,
        /// Origin in the parent's frame, Y-down, for children of free frames and the page and for absolute children.
        pub x: f64,
        pub y: f64,
        /// Frames only; a frame without one is free.
        pub frame: Option<LayoutFrameInput>,
        /// Text runs only; a text run without one is empty.
        pub text: Option<LayoutTextInput>,
        /// Fixed leaves only: the size they hug.
        pub intrinsic: Option<LayoutSizeInput>,
    }
}

layout! {
    /// One page's layout tree, parents before children, the page first.
    pub struct LayoutPageInput {
        pub nodes: Vec<LayoutNodeInput>,
    }
}

layout! {
    /// A node's origin in its parent's frame and its size, Y-down, scene units.
    pub struct LayoutBoxOutput {
        pub x: f64,
        pub y: f64,
        pub width: f64,
        pub height: f64,
    }
}

layout! {
    /// One line of a text run: segments from `start` up to `end`.
    pub struct LayoutLineOutput {
        pub start: usize,
        pub end: usize,
        /// Without the trailing space, in the run's units.
        pub width: f64,
    }
}

layout! {
    /// A text run's lines at its laid-out width.
    pub struct LayoutTextLinesOutput {
        /// The text run's index in the input nodes.
        pub node: usize,
        pub lines: Vec<LayoutLineOutput>,
    }
}

layout! {
    /// Every box on a page and every text run's lines.
    pub struct LayoutPageOutput {
        /// One per input node, in input order.
        pub boxes: Vec<LayoutBoxOutput>,
        /// One per text run, in input order.
        pub text_lines: Vec<LayoutTextLinesOutput>,
    }
}

#[cfg(feature = "layout")]
mod exports {
    use shift_layout::{
        Align, BreakSegments, FrameLayout, Insets, Justify, LayoutMode, LayoutNode, LayoutTree,
        NodeKind, PageLayout, Placement, Point, Size, Sizing,
    };
    use wasm_bindgen::prelude::*;

    use super::{
        LayoutAlign, LayoutBoxOutput, LayoutFrameInput, LayoutFrameMode, LayoutJustify,
        LayoutLineOutput, LayoutNodeInput, LayoutNodeKind, LayoutPageInput, LayoutPageOutput,
        LayoutPlacement, LayoutSizing, LayoutSizingMode, LayoutTextInput, LayoutTextLinesOutput,
    };
    use crate::layout::call;

    /// Input: `LayoutPageInput`. Output: `LayoutPageOutput`, or null when
    /// the tree is malformed (`LayoutTree::layout`'s errors).
    #[wasm_bindgen(js_name = layoutPage)]
    pub fn layout_page(input: &[f64]) -> Vec<f64> {
        call(input, |page: LayoutPageInput| {
            let tree = LayoutTree {
                nodes: page.nodes.into_iter().map(LayoutNode::from).collect(),
            };
            tree.layout().ok().map(LayoutPageOutput::from)
        })
    }

    impl From<LayoutNodeInput> for LayoutNode {
        fn from(node: LayoutNodeInput) -> Self {
            let kind = match node.kind {
                LayoutNodeKind::Page => NodeKind::Page,
                LayoutNodeKind::Frame => {
                    NodeKind::Frame(node.frame.map_or(FrameLayout::FREE, FrameLayout::from))
                }
                LayoutNodeKind::Text => NodeKind::Text(node.text.map_or_else(
                    || BreakSegments {
                        scale: 1.0,
                        ..BreakSegments::default()
                    },
                    BreakSegments::from,
                )),
                LayoutNodeKind::Fixed => NodeKind::Fixed(
                    node.intrinsic
                        .map_or(Size::ZERO, |size| Size::new(size.width, size.height)),
                ),
            };
            Self {
                parent: node.parent,
                kind,
                width: node.width.into(),
                height: node.height.into(),
                placement: match node.placement {
                    LayoutPlacement::Auto => Placement::Auto,
                    LayoutPlacement::Absolute => Placement::Absolute,
                },
                position: Point::new(node.x, node.y),
            }
        }
    }

    impl From<LayoutSizing> for Sizing {
        fn from(sizing: LayoutSizing) -> Self {
            match sizing.mode {
                LayoutSizingMode::Fixed => Self::Fixed(sizing.size),
                LayoutSizingMode::Hug => Self::Hug,
                LayoutSizingMode::Fill => Self::Fill,
            }
        }
    }

    impl From<LayoutFrameInput> for FrameLayout {
        fn from(frame: LayoutFrameInput) -> Self {
            let padding = frame.padding;
            Self {
                mode: match frame.mode {
                    LayoutFrameMode::Free => LayoutMode::Free,
                    LayoutFrameMode::Row => LayoutMode::Row,
                    LayoutFrameMode::Column => LayoutMode::Column,
                },
                gap: frame.gap,
                padding: Insets {
                    top: padding.top,
                    right: padding.right,
                    bottom: padding.bottom,
                    left: padding.left,
                },
                align: match frame.align {
                    LayoutAlign::Start => Align::Start,
                    LayoutAlign::Center => Align::Center,
                    LayoutAlign::End => Align::End,
                    LayoutAlign::Baseline => Align::Baseline,
                },
                justify: match frame.justify {
                    LayoutJustify::Start => Justify::Start,
                    LayoutJustify::Center => Justify::Center,
                    LayoutJustify::End => Justify::End,
                    LayoutJustify::SpaceBetween => Justify::SpaceBetween,
                },
                wrap: frame.wrap,
            }
        }
    }

    impl From<LayoutTextInput> for BreakSegments {
        fn from(text: LayoutTextInput) -> Self {
            Self {
                widths: text.widths,
                trailing: text.trailing,
                hard_breaks: text.hard_breaks,
                line_height: text.line_height,
                scale: text.scale,
            }
        }
    }

    impl From<PageLayout> for LayoutPageOutput {
        fn from(layout: PageLayout) -> Self {
            Self {
                boxes: layout
                    .boxes
                    .into_iter()
                    .map(|node| LayoutBoxOutput {
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                    })
                    .collect(),
                text_lines: layout
                    .text_lines
                    .into_iter()
                    .map(|text| LayoutTextLinesOutput {
                        node: text.node,
                        lines: text
                            .lines
                            .into_iter()
                            .map(|line| LayoutLineOutput {
                                start: line.start,
                                end: line.end,
                                width: line.width,
                            })
                            .collect(),
                    })
                    .collect(),
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::layout::Layout;
        use crate::names::with_names;
        use crate::page_layout::{LayoutInsets, LayoutSizeInput};

        fn hug() -> LayoutSizing {
            LayoutSizing {
                mode: LayoutSizingMode::Hug,
                size: 0.0,
            }
        }

        fn node(parent: Option<usize>, kind: LayoutNodeKind) -> LayoutNodeInput {
            LayoutNodeInput {
                parent,
                kind,
                width: hug(),
                height: hug(),
                placement: LayoutPlacement::Auto,
                x: 0.0,
                y: 0.0,
                frame: None,
                text: None,
                intrinsic: None,
            }
        }

        fn encode<T: Layout>(value: &T) -> Vec<f64> {
            with_names(|names| {
                let mut write = crate::layout::Writer::new(names);
                value.write(&mut write);
                write.finish()
            })
        }

        fn decode<T: Layout>(values: &[f64]) -> T {
            with_names(|names| T::read(&mut crate::layout::Reader::new(values, &*names)))
        }

        #[test]
        fn a_page_crosses_the_boundary_and_lays_out() {
            let column = LayoutNodeInput {
                frame: Some(LayoutFrameInput {
                    mode: LayoutFrameMode::Column,
                    gap: 10.0,
                    padding: LayoutInsets {
                        top: 5.0,
                        right: 5.0,
                        bottom: 5.0,
                        left: 5.0,
                    },
                    align: LayoutAlign::Start,
                    justify: LayoutJustify::Start,
                    wrap: false,
                }),
                width: LayoutSizing {
                    mode: LayoutSizingMode::Fixed,
                    size: 85.0,
                },
                ..node(Some(0), LayoutNodeKind::Frame)
            };
            let text = LayoutNodeInput {
                width: LayoutSizing {
                    mode: LayoutSizingMode::Fill,
                    size: 0.0,
                },
                text: Some(LayoutTextInput {
                    widths: vec![30.0, 30.0, 30.0],
                    trailing: vec![10.0, 10.0, 10.0],
                    hard_breaks: vec![],
                    line_height: 12.0,
                    scale: 1.0,
                }),
                ..node(Some(1), LayoutNodeKind::Text)
            };
            let leaf = LayoutNodeInput {
                intrinsic: Some(LayoutSizeInput {
                    width: 20.0,
                    height: 8.0,
                }),
                ..node(Some(1), LayoutNodeKind::Fixed)
            };
            let input = LayoutPageInput {
                nodes: vec![node(None, LayoutNodeKind::Page), column, text, leaf],
            };

            let output: Option<LayoutPageOutput> = decode(&layout_page(&encode(&input)));

            let output = output.unwrap();
            let boxes: Vec<[f64; 4]> = output
                .boxes
                .iter()
                .map(|node| [node.x, node.y, node.width, node.height])
                .collect();
            assert_eq!(
                boxes,
                [
                    [0.0, 0.0, 85.0, 52.0],
                    [0.0, 0.0, 85.0, 52.0],
                    [5.0, 5.0, 75.0, 24.0],
                    [5.0, 39.0, 20.0, 8.0],
                ]
            );
            assert_eq!(output.text_lines.len(), 1);
            assert_eq!(output.text_lines[0].node, 2);
            assert_eq!(
                output.text_lines[0].lines,
                [
                    LayoutLineOutput {
                        start: 0,
                        end: 2,
                        width: 70.0,
                    },
                    LayoutLineOutput {
                        start: 2,
                        end: 3,
                        width: 30.0,
                    },
                ]
            );
        }

        #[test]
        fn a_malformed_page_lays_out_as_null() {
            let input = LayoutPageInput {
                nodes: vec![node(Some(0), LayoutNodeKind::Page)],
            };

            let output: Option<LayoutPageOutput> = decode(&layout_page(&encode(&input)));

            assert_eq!(output, None);
        }
    }
}
