//! A page of the scene laid out: frames placing their children in rows and
//! columns, and text runs measured by the same text layout
//! [`EngineReads::layout_text`](crate::engine_reads::EngineReads::layout_text)
//! answers with, so a run wraps on a page as it does anywhere else.
//! Answered by
//! [`EngineReads::page_layout`](crate::engine_reads::EngineReads::page_layout).
//!
//! The scene's nodes become a shift-layout tree: the page, its frames, its
//! text runs, and the glyphs placed outside runs as points (a glyph has no
//! box yet). A text run's own children, the glyphs edited in place, are left
//! to the run's text layout, as are the children of anything that is not a
//! page or a frame.

use pack::Pack;
use shift_font::{GlyphId, NodeId};
use shift_text::layout::{LayoutError, LayoutLine};

/// A page to lay out, and where its text is laid out.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PageLayoutRequest {
    pub page: NodeId,
    /// The design location text lays out at, in the font's axis order with
    /// NaN for an axis default, as `TextLayoutRequest::location` takes it.
    pub location: Vec<f64>,
    /// A source, by the number the session interned, to lay text out at
    /// instead, as its own layers draw.
    pub source: Option<usize>,
}

/// Every node of a page placed, and the lines each text run shows.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct PageLayout {
    /// The page and each node laid out under it, parents before children,
    /// siblings in order.
    pub boxes: Vec<NodeBox>,
    /// Each text run's lines, in the order of `boxes`.
    pub runs: Vec<RunLines>,
    /// The glyphs the runs show whose layers the session has not loaded,
    /// which laid out from their placeholders.
    pub unloaded: Vec<GlyphId>,
}

/// A node's box: its origin in its parent's box, or for the page in the
/// scene, and its size; Y-down, in scene units.
///
/// A text run's first line's top edge is the box's top: its baseline sits
/// the line's ascent below it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct NodeBox {
    pub id: NodeId,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The lines a text run shows at the width the page gave it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum RunLines {
    Lines {
        id: NodeId,
        /// The width the lines break at, in font units, as
        /// `TextOptions::width` takes it: what to lay the run out at for the
        /// same lines. `None` for a run whose width hugs, one line per
        /// paragraph.
        width: Option<f64>,
        /// As `TextLayout::lines` gives them: font units, Y up, line 0's
        /// baseline at 0.
        lines: Vec<LayoutLine>,
    },
    /// The run's text could not be laid out, and takes no room.
    Unlaid { id: NodeId, error: LayoutError },
}

/// Why a page could not be laid out.
#[derive(Clone, Debug, PartialEq, Eq, Pack, thiserror::Error)]
pub enum PageLayoutError {
    #[error("scene node {id} is not a page")]
    NotAPage { id: NodeId },
    /// The page's nodes made a tree layout refuses; `detail` is why.
    #[error("the page's nodes cannot be laid out: {detail}")]
    Malformed { detail: String },
}

#[cfg(feature = "engine")]
pub(crate) use exports::lay_out_page;

#[cfg(feature = "engine")]
mod exports {
    use std::collections::{BTreeMap, BTreeSet};

    use shift_engine::scene::{NodeContent, Scene, SceneNode};
    use shift_font::GlyphId;
    use shift_layout::{LayoutNode, LayoutTree, MeasureText, NodeKind, Point, Size};
    use shift_text::layout::{LayoutError, LayoutRequest, TextLayout};

    use super::{NodeBox, NodeId, PageLayout, PageLayoutError, RunLines};

    /// Lays out `page` of `scene`, each text run through `lay_out`, which
    /// lays a run's text out over the font as `TextShaping` does; runs are
    /// sized at their `size` over `units_per_em`. Returns the layout, its
    /// `unloaded` empty, and every glyph its runs show.
    ///
    /// # Errors
    ///
    /// Returns [`PageLayoutError::NotAPage`] when `page` is not a page of
    /// `scene`, and [`PageLayoutError::Malformed`] should its nodes make a
    /// tree shift-layout refuses, which a scene's checked placement rules
    /// out.
    pub(crate) fn lay_out_page(
        scene: &Scene,
        page: &NodeId,
        units_per_em: f64,
        lay_out: &mut dyn FnMut(&LayoutRequest) -> Result<TextLayout, LayoutError>,
    ) -> Result<(PageLayout, BTreeSet<GlyphId>), PageLayoutError> {
        let not_a_page = || PageLayoutError::NotAPage { id: page.clone() };
        let page = scene
            .node(page)
            .filter(|node| node.is_page())
            .ok_or_else(not_a_page)?;
        let nodes = PageNodes::of(scene, page);
        let mut text = RunText {
            requests: BTreeMap::new(),
            laid_out: BTreeMap::new(),
            lay_out,
        };
        for (index, node) in nodes.nodes.iter().enumerate() {
            if let Some(run) = TextRequest::of(node, units_per_em) {
                text.requests.insert(index, run);
            }
        }
        let laid_out =
            nodes
                .tree
                .layout(&mut text)
                .map_err(|error| PageLayoutError::Malformed {
                    detail: error.to_string(),
                })?;

        let boxes = nodes
            .nodes
            .iter()
            .zip(&laid_out.boxes)
            .map(|(node, laid)| NodeBox {
                id: node.id.clone(),
                x: laid.x,
                y: laid.y,
                width: laid.width,
                height: laid.height,
            })
            .collect();
        let mut glyphs = BTreeSet::new();
        let runs = laid_out
            .text_widths
            .iter()
            .map(|text_width| {
                let id = nodes.nodes[text_width.node].id.clone();
                let (width, layout) = text.lines_at(text_width.node, text_width.width);
                match layout {
                    Ok(layout) => {
                        glyphs.extend(layout.glyph_ids());
                        RunLines::Lines {
                            id,
                            width,
                            lines: layout.lines,
                        }
                    }
                    Err(error) => RunLines::Unlaid { id, error },
                }
            })
            .collect();
        let layout = PageLayout {
            boxes,
            runs,
            unloaded: Vec::new(),
        };
        Ok((layout, glyphs))
    }

    /// A page's nodes in the order they lay out, beside the layout tree made
    /// of them: the same index names a node in both.
    struct PageNodes<'s> {
        nodes: Vec<&'s SceneNode>,
        tree: LayoutTree,
    }

    impl<'s> PageNodes<'s> {
        /// `page` and every node laid out under it, parents first.
        fn of(scene: &'s Scene, page: &'s SceneNode) -> Self {
            let mut found = Self {
                nodes: Vec::new(),
                tree: LayoutTree::default(),
            };
            found.add(scene, page, None);
            found
        }

        /// Adds `node` under the node at `parent`, then its children when it
        /// places them.
        fn add(&mut self, scene: &'s Scene, node: &'s SceneNode, parent: Option<usize>) {
            let index = self.nodes.len();
            let kind = layout_kind(node);
            let places_children = matches!(kind, NodeKind::Page | NodeKind::Frame(_));
            self.nodes.push(node);
            self.tree.nodes.push(LayoutNode {
                parent,
                kind,
                sizing: node.sizing,
                placement: node.placement,
                position: Point::new(node.x, node.y),
            });
            if !places_children {
                return;
            }
            for child in scene.children(Some(&node.id)) {
                if !child.is_page() {
                    self.add(scene, child, Some(index));
                }
            }
        }
    }

    /// What `node` is to layout.
    fn layout_kind(node: &SceneNode) -> NodeKind {
        match &node.content {
            NodeContent::Page { .. } => NodeKind::Page,
            NodeContent::TextRun { .. } => NodeKind::Text,
            NodeContent::Frame { .. } => NodeKind::Frame(node.frame_layout().unwrap_or_default()),
            NodeContent::Glyph { .. } => NodeKind::Fixed(Size::ZERO),
        }
    }

    /// A text run as layout measures it: its request without a width, and
    /// how many scene units one of its font units spans.
    struct TextRequest {
        request: LayoutRequest,
        /// The run's size over the font's units per em; zero for a size that
        /// is not positive and finite, which lays out as nothing.
        scale: f64,
    }

    impl TextRequest {
        /// The request `node` lays out with, when it is a text run.
        fn of(node: &SceneNode, units_per_em: f64) -> Option<Self> {
            let NodeContent::TextRun {
                size,
                items,
                settings,
                ..
            } = &node.content
            else {
                return None;
            };
            let run = shift_engine::scene::TextRun {
                items: items.clone(),
                settings: settings.clone(),
            };
            let scale = size / units_per_em;
            Some(Self {
                request: run.layout_request(),
                scale: if scale.is_finite() && scale > 0.0 {
                    scale
                } else {
                    0.0
                },
            })
        }

        /// A width in scene units as the font units lines break at. A width
        /// of zero asks for the narrowest lines, which shift-text, reading
        /// zero as no width, gives for the narrowest positive one.
        fn font_width(&self, width: Option<f64>) -> Option<f64> {
            let width = width.filter(|_| self.scale > 0.0)?;
            Some((width / self.scale).max(f64::MIN_POSITIVE))
        }
    }

    /// Measures the page's text runs, keeping each layout per run and width
    /// for the rest of the pass.
    struct RunText<'f> {
        requests: BTreeMap<usize, TextRequest>,
        laid_out: BTreeMap<(usize, Option<u64>), Result<TextLayout, LayoutError>>,
        lay_out: &'f mut dyn FnMut(&LayoutRequest) -> Result<TextLayout, LayoutError>,
    }

    impl RunText<'_> {
        /// Run `node` laid out at `width` font units, kept for the pass.
        fn laid_out(
            &mut self,
            node: usize,
            width: Option<f64>,
        ) -> &Result<TextLayout, LayoutError> {
            let Self {
                requests,
                laid_out,
                lay_out,
            } = self;
            laid_out
                .entry((node, width.map(f64::to_bits)))
                .or_insert_with(|| {
                    let Some(run) = requests.get(&node) else {
                        return Ok(TextLayout::default());
                    };
                    let mut request = run.request.clone();
                    request.options.width = width;
                    lay_out(&request)
                })
        }

        /// Run `node`'s width in font units at `width` scene units, and its
        /// layout there, taken from the pass.
        fn lines_at(
            &mut self,
            node: usize,
            width: Option<f64>,
        ) -> (Option<f64>, Result<TextLayout, LayoutError>) {
            let width = self
                .requests
                .get(&node)
                .and_then(|run| run.font_width(width));
            self.laid_out(node, width);
            let layout = self
                .laid_out
                .remove(&(node, width.map(f64::to_bits)))
                .unwrap_or_else(|| Ok(TextLayout::default()));
            (width, layout)
        }
    }

    impl MeasureText for RunText<'_> {
        fn measure(&mut self, node: usize, width: Option<f64>) -> Size {
            let Some((scale, width)) = self
                .requests
                .get(&node)
                .map(|run| (run.scale, run.font_width(width)))
            else {
                return Size::ZERO;
            };
            let Ok(layout) = self.laid_out(node, width) else {
                return Size::ZERO;
            };
            let widest = layout
                .lines
                .iter()
                .map(|line| line.advance)
                .fold(0.0, f64::max);
            // An empty run is still one line tall, where its caret goes.
            let lines = layout.lines.len().max(1);
            #[allow(clippy::cast_precision_loss, reason = "a line count is far below 2^52")]
            let height = lines as f64 * layout.line_height;
            Size::new(widest * scale, height * scale)
        }
    }
}

#[cfg(feature = "engine")]
#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use shift_engine::scene::{
        Align, BoxSizing, Insets, Justify, LayoutDirection, NodeContent, Placement, RunSettings,
        Scene, SceneNode, Sizing, TextItem,
    };
    use shift_font::interpolation::KerningBlend;
    use shift_font::{
        DesignLocation, ExternalLocation, Font, Glyph, GlyphClasses, GlyphDataCategory, GlyphLayer,
        LayerId, NodeId, RunId, ShaperFontSource, TextItemId, index_key,
    };

    use super::exports::lay_out_page;
    use super::{NodeBox, PageLayout, PageLayoutError, RunLines};
    use crate::shaping::{TextPlace, TextShaping};

    /// A font where `a` and the space advance 100 units of its 1000 per em.
    fn font() -> Font {
        let mut font = Font::new();
        let source = font.default_source_id().unwrap();
        for (name, character) in [("a", 'a'), ("space", ' ')] {
            let mut glyph = Glyph::new(name);
            glyph.add_unicode(u32::from(character));
            glyph.set_layer(GlyphLayer::with_width(LayerId::new(), source, 100.0));
            font.insert_glyph(glyph).unwrap();
        }
        font
    }

    fn source(font: &Font) -> ShaperFontSource {
        let classes =
            GlyphClasses::of_loaded(font.glyphs(), font.lib(), |_| GlyphDataCategory::default());
        font.shaper_font_source(&classes)
    }

    /// The sibling key at `position`.
    fn key(position: usize) -> String {
        let mut key = index_key::between(None, None).unwrap();
        for _ in 0..position {
            key = index_key::between(Some(&key), None).unwrap();
        }
        key
    }

    fn node(id: &str, parent: Option<&str>, position: usize, content: NodeContent) -> SceneNode {
        SceneNode {
            id: NodeId::from_raw(id),
            parent_id: parent.map(NodeId::from_raw),
            index: key(position),
            x: 0.0,
            y: 0.0,
            sizing: BoxSizing::default(),
            placement: Placement::Absolute,
            content,
        }
    }

    fn page() -> SceneNode {
        node(
            "page",
            None,
            0,
            NodeContent::Page {
                name: "Page".into(),
                role: None,
            },
        )
    }

    fn frame(id: &str, direction: LayoutDirection, gap: f64, padding: f64) -> SceneNode {
        node(
            id,
            Some("page"),
            0,
            NodeContent::Frame {
                direction,
                gap,
                padding: Insets::uniform(padding),
                align: Align::Start,
                justify: Justify::Start,
                wrap: false,
            },
        )
    }

    /// A text run of `text` at the font's own size, on lines 1200 units
    /// apart, following its parent's layout.
    fn run(id: &str, parent: &str, position: usize, text: &str) -> SceneNode {
        let items = text
            .chars()
            .enumerate()
            .map(|(index, character)| TextItem::Character {
                id: TextItemId::from_raw(format!("{id}_{index}")),
                codepoint: u32::from(character),
            })
            .collect();
        SceneNode {
            placement: Placement::Auto,
            ..node(
                id,
                Some(parent),
                position,
                NodeContent::TextRun {
                    run_id: RunId::from_raw(id),
                    size: 1000.0,
                    items,
                    settings: RunSettings {
                        line_height: Some(1.2),
                        ..RunSettings::default()
                    },
                },
            )
        }
    }

    fn lay_out(nodes: Vec<SceneNode>) -> Result<PageLayout, PageLayoutError> {
        let font = font();
        let scene: Scene = nodes.into_iter().collect();
        let place = TextPlace {
            design: DesignLocation::new(),
            external: ExternalLocation::new(),
            kerning: KerningBlend::default(),
        };
        let units_per_em = font.metrics().units_per_em;
        TextShaping::default()
            .with_layout_font(
                &font,
                || Ok::<_, Infallible>(source(&font)),
                place,
                |lay_out| lay_out_page(&scene, &NodeId::from_raw("page"), units_per_em, lay_out),
            )
            .map(|(layout, _)| layout)
    }

    /// Node `id`'s box as `[x, y, width, height]`.
    fn rect(layout: &PageLayout, id: &str) -> [f64; 4] {
        let NodeBox {
            x,
            y,
            width,
            height,
            ..
        } = layout
            .boxes
            .iter()
            .find(|laid| laid.id == NodeId::from_raw(id))
            .unwrap();
        [*x, *y, *width, *height]
    }

    /// Run `id`'s width and lines, as the units each covers.
    fn lines(layout: &PageLayout, id: &str) -> (Option<f64>, Vec<(u32, u32)>) {
        let found = layout.runs.iter().find_map(|run| match run {
            RunLines::Lines {
                id: run,
                width,
                lines,
            } if *run == NodeId::from_raw(id) => Some((
                *width,
                lines.iter().map(|line| (line.start, line.end)).collect(),
            )),
            _ => None,
        });
        found.unwrap()
    }

    #[test]
    fn a_row_frame_places_its_two_text_runs_side_by_side() {
        let row = SceneNode {
            x: 40.0,
            y: 30.0,
            ..frame("row", LayoutDirection::Row, 50.0, 10.0)
        };

        let layout = lay_out(vec![
            page(),
            row,
            run("first", "row", 0, "aa"),
            run("second", "row", 1, "aaa"),
        ])
        .unwrap();

        assert_eq!(rect(&layout, "first"), [10.0, 10.0, 200.0, 1200.0]);
        assert_eq!(rect(&layout, "second"), [260.0, 10.0, 300.0, 1200.0]);
        assert_eq!(rect(&layout, "row"), [40.0, 30.0, 570.0, 1220.0]);
        assert_eq!(lines(&layout, "first"), (None, vec![(0, 2)]));
        assert_eq!(lines(&layout, "second"), (None, vec![(0, 3)]));
    }

    #[test]
    fn a_text_run_wraps_inside_a_fixed_width_frame_where_shift_text_breaks() {
        let column = SceneNode {
            sizing: BoxSizing::new(Sizing::Fixed(750.0), Sizing::Hug),
            ..frame("column", LayoutDirection::Column, 0.0, 0.0)
        };
        let wrapping = SceneNode {
            sizing: BoxSizing::new(Sizing::Fill, Sizing::Hug),
            ..run("text", "column", 0, "aaa aaa aaa")
        };

        let layout = lay_out(vec![page(), column, wrapping]).unwrap();

        // "aaa aaa " fits in 750; the last word goes to a second line.
        assert_eq!(rect(&layout, "text"), [0.0, 0.0, 750.0, 2400.0]);
        assert_eq!(lines(&layout, "text"), (Some(750.0), vec![(0, 8), (8, 11)]));
        assert_eq!(rect(&layout, "column")[3], 2400.0);
    }

    #[test]
    fn a_run_on_the_page_keeps_its_position_and_an_empty_one_is_a_line_tall() {
        let placed = SceneNode {
            x: 120.0,
            y: -40.0,
            placement: Placement::Absolute,
            ..run("placed", "page", 0, "")
        };

        let layout = lay_out(vec![page(), placed]).unwrap();

        assert_eq!(rect(&layout, "placed"), [120.0, -40.0, 0.0, 1200.0]);
        assert_eq!(lines(&layout, "placed"), (None, vec![]));
    }

    #[test]
    fn a_glyph_edited_in_a_run_is_left_to_the_run() {
        let edited = node(
            "edited",
            Some("text"),
            0,
            NodeContent::Glyph {
                glyph_id: font().glyph_by_name("a").unwrap().id(),
                source_id: font().default_source_id().unwrap(),
                item_id: Some(TextItemId::from_raw("text_0")),
            },
        );

        let layout = lay_out(vec![page(), run("text", "page", 0, "a"), edited]).unwrap();

        let ids: Vec<&NodeId> = layout.boxes.iter().map(|laid| &laid.id).collect();
        assert_eq!(ids, [&NodeId::from_raw("page"), &NodeId::from_raw("text")]);
    }

    #[test]
    fn only_a_page_lays_out() {
        let scene: Scene = [page(), run("text", "page", 0, "a")].into_iter().collect();

        let not_a_page = lay_out_page(&scene, &NodeId::from_raw("text"), 1000.0, &mut |_| {
            unreachable!("nothing is laid out")
        });

        assert_eq!(
            not_a_page.map(|_| ()),
            Err(PageLayoutError::NotAPage {
                id: NodeId::from_raw("text")
            })
        );
    }
}
