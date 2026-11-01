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
pub(crate) use exports::{PlaceKey, RunLayouts, lay_out_page};

#[cfg(feature = "engine")]
mod exports {
    use std::collections::btree_map::Entry;
    use std::collections::{BTreeMap, BTreeSet};

    use shift_engine::scene::{NodeContent, Scene, SceneNode};
    use shift_font::{FontChangeImpact, GlyphId};
    use shift_layout::{LayoutNode, LayoutTree, MeasureText, NodeKind, Point, Size};
    use shift_text::layout::{LayoutError, LayoutFont, LayoutLine, TextMeasure, TextSize};

    use super::{NodeBox, NodeId, PageLayout, PageLayoutError, RunLines};
    use crate::shaping::TextShaping;

    /// Each text run as page layout last measured it, kept between layouts
    /// so a run is shaped again only when its text, the font or the place
    /// text lays out at changed: its shaped text, and its size and layout
    /// at each width layout tried.
    ///
    /// A run is kept under its items revision, which changes with its items
    /// and settings; a font change drops every run, as the session's shaper
    /// is brought up to date ([`Self::forget_if_changed`]), and so does
    /// laying out at another place.
    #[derive(Default)]
    pub(crate) struct RunLayouts {
        place: Option<PlaceKey>,
        runs: BTreeMap<NodeId, KeptRun>,
        /// How many times a run was shaped, for tests to tell a kept run from
        /// one shaped again.
        shapes: usize,
    }

    /// Where text lays out, as page layout keeps runs for: the design
    /// location's values, bit for bit, and the source.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub(crate) struct PlaceKey {
        location: Vec<u64>,
        source: Option<usize>,
    }

    impl PlaceKey {
        pub(crate) fn new(location: &[f64], source: Option<usize>) -> Self {
            Self {
                location: location.iter().map(|value| value.to_bits()).collect(),
                source,
            }
        }
    }

    /// One run as [`RunLayouts`] keeps it. Widths are font units, by their
    /// bits.
    struct KeptRun {
        items_revision: usize,
        measure: Result<TextMeasure, LayoutError>,
        sizes: BTreeMap<Option<u64>, TextSize>,
        lines: BTreeMap<Option<u64>, Result<LaidRun, LayoutError>>,
    }

    /// What a page layout keeps of a run laid out at one width: its lines
    /// and the glyphs it shows.
    #[derive(Clone)]
    struct LaidRun {
        lines: Vec<LayoutLine>,
        glyphs: BTreeSet<GlyphId>,
    }

    impl RunLayouts {
        /// Drops every run when a change with `impact` may change how text
        /// lays out ([`TextShaping::LAYOUT_INPUTS`]).
        pub(crate) fn forget_if_changed(&mut self, impact: FontChangeImpact) {
            if impact.intersects(TextShaping::LAYOUT_INPUTS) {
                self.runs.clear();
            }
        }

        /// How many times a run was shaped since the session opened.
        #[cfg(test)]
        pub(crate) fn shapes(&self) -> usize {
            self.shapes
        }

        /// Keeps runs only for laying out at `place`.
        fn lay_out_at(&mut self, place: PlaceKey) {
            if self.place.as_ref() != Some(&place) {
                self.runs.clear();
                self.place = Some(place);
            }
        }

        /// Run `id` as kept, shaped again over `font` when its items revision
        /// is not the kept one.
        fn run(&mut self, font: &LayoutFont<'_>, request: &TextRequest) -> &mut KeptRun {
            let shaped = || KeptRun {
                items_revision: request.items_revision,
                measure: TextMeasure::new(font, &request.run.layout_request()),
                sizes: BTreeMap::new(),
                lines: BTreeMap::new(),
            };
            match self.runs.entry(request.id.clone()) {
                Entry::Occupied(kept) if kept.get().items_revision == request.items_revision => {
                    kept.into_mut()
                }
                Entry::Occupied(mut stale) => {
                    self.shapes += 1;
                    stale.insert(shaped());
                    stale.into_mut()
                }
                Entry::Vacant(absent) => {
                    self.shapes += 1;
                    absent.insert(shaped())
                }
            }
        }
    }

    impl KeptRun {
        /// The run's size at `width` font units; nothing for text that
        /// cannot be laid out.
        fn size(&mut self, font: &LayoutFont<'_>, width: Option<f64>) -> Option<TextSize> {
            let measure = self.measure.as_ref().ok()?;
            Some(
                *self
                    .sizes
                    .entry(width.map(f64::to_bits))
                    .or_insert_with(|| measure.size(font, width)),
            )
        }

        /// The run laid out at `width` font units: its lines and glyphs.
        fn laid_out(
            &mut self,
            font: &LayoutFont<'_>,
            width: Option<f64>,
        ) -> Result<LaidRun, LayoutError> {
            let measure = match &self.measure {
                Ok(measure) => measure,
                Err(error) => return Err(*error),
            };
            self.lines
                .entry(width.map(f64::to_bits))
                .or_insert_with(|| {
                    measure.layout(font, width).map(|layout| LaidRun {
                        glyphs: layout.glyph_ids(),
                        lines: layout.lines,
                    })
                })
                .clone()
        }
    }

    /// Lays out `page` of `scene`, each text run over `font` at `place`,
    /// sized at its `size` over `units_per_em`, keeping what it measured in
    /// `kept` for the next layout. Returns the layout, its `unloaded` empty,
    /// and every glyph its runs show.
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
        font: &LayoutFont<'_>,
        place: PlaceKey,
        kept: &mut RunLayouts,
    ) -> Result<(PageLayout, BTreeSet<GlyphId>), PageLayoutError> {
        let not_a_page = || PageLayoutError::NotAPage { id: page.clone() };
        let page = scene
            .node(page)
            .filter(|node| node.is_page())
            .ok_or_else(not_a_page)?;
        kept.lay_out_at(place);
        let nodes = PageNodes::of(scene, page);
        let requests = nodes
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(index, node)| Some((index, TextRequest::of(scene, node, units_per_em)?)))
            .collect();
        let mut text = RunText {
            requests,
            font,
            kept,
        };
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
            .filter_map(|text_width| {
                let (id, width, layout) = text.lines_at(text_width.node, text_width.width)?;
                Some(match layout {
                    Ok(layout) => {
                        glyphs.extend(layout.glyphs);
                        RunLines::Lines {
                            id,
                            width,
                            lines: layout.lines,
                        }
                    }
                    Err(error) => RunLines::Unlaid { id, error },
                })
            })
            .collect();
        // Runs no longer in the scene are not laid out again.
        text.kept.runs.retain(|id, _| scene.node(id).is_some());
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
        if let Some(frame) = node.frame_layout() {
            return NodeKind::Frame(frame);
        }
        match &node.content {
            NodeContent::Page { .. } => NodeKind::Page,
            NodeContent::TextRun { .. } => NodeKind::Text,
            NodeContent::Frame { .. } | NodeContent::Glyph { .. } => NodeKind::Fixed(Size::ZERO),
        }
    }

    /// A text run as layout measures it: its text, when that last changed,
    /// and how many scene units one of its font units spans.
    struct TextRequest {
        id: NodeId,
        items_revision: usize,
        run: shift_engine::scene::TextRun,
        /// The run's size over the font's units per em; zero for a size that
        /// is not positive and finite, which lays out as nothing.
        scale: f64,
    }

    impl TextRequest {
        /// The request `node` lays out with, when it is a text run of
        /// `scene`.
        fn of(scene: &Scene, node: &SceneNode, units_per_em: f64) -> Option<Self> {
            let NodeContent::TextRun {
                size,
                items,
                settings,
                ..
            } = &node.content
            else {
                return None;
            };
            let scale = size / units_per_em;
            Some(Self {
                id: node.id.clone(),
                items_revision: scene.items_revision(&node.id)?,
                run: shift_engine::scene::TextRun {
                    items: items.clone(),
                    settings: settings.clone(),
                },
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

    /// Measures the page's text runs through what `kept` holds of them.
    struct RunText<'f, 'a, 'k> {
        requests: BTreeMap<usize, TextRequest>,
        font: &'f LayoutFont<'a>,
        kept: &'k mut RunLayouts,
    }

    impl RunText<'_, '_, '_> {
        /// Run `node`'s id, its width in font units at `width` scene units,
        /// and its layout there.
        fn lines_at(
            &mut self,
            node: usize,
            width: Option<f64>,
        ) -> Option<(NodeId, Option<f64>, Result<LaidRun, LayoutError>)> {
            let request = self.requests.get(&node)?;
            let width = request.font_width(width);
            let layout = self.kept.run(self.font, request).laid_out(self.font, width);
            Some((request.id.clone(), width, layout))
        }
    }

    impl MeasureText for RunText<'_, '_, '_> {
        fn measure(&mut self, node: usize, width: Option<f64>) -> Size {
            let Some(request) = self.requests.get(&node) else {
                return Size::ZERO;
            };
            let scale = request.scale;
            let width = request.font_width(width);
            let Some(size) = self.kept.run(self.font, request).size(self.font, width) else {
                return Size::ZERO;
            };
            // An empty run is still one line tall, where its caret goes.
            let lines = size.lines.max(1);
            let height = f64::from(lines) * size.line_height;
            Size::new(size.width * scale, height * scale)
        }
    }
}

#[cfg(feature = "engine")]
#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use shift_engine::scene::{
        Align, BoxSizing, Insets, Justify, LayoutDirection, MoveNode, NodeContent, Placement,
        RunSettings, Scene, SceneIntent, SceneNode, SetRunItems, Sizing, TextItem,
    };
    use shift_font::interpolation::KerningBlend;
    use shift_font::{
        DesignLocation, ExternalLocation, Font, FontChangeImpact, Glyph, GlyphClasses,
        GlyphDataCategory, GlyphLayer, LayerId, NodeId, RunId, ShaperFontSource, TextItemId,
        index_key,
    };

    use super::exports::{PlaceKey, RunLayouts, lay_out_page};
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

    fn page_node() -> SceneNode {
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
        let scene: Scene = nodes.into_iter().collect();
        Page::new().lay_out(&scene, &[])
    }

    /// A session's font and shaper, and the runs page layout keeps.
    struct Page {
        font: Font,
        shaping: TextShaping,
        kept: RunLayouts,
    }

    impl Page {
        fn new() -> Self {
            Self {
                font: font(),
                shaping: TextShaping::default(),
                kept: RunLayouts::default(),
            }
        }

        /// Lays out `scene`'s page at `location`, keeping what it measured.
        fn lay_out(
            &mut self,
            scene: &Scene,
            location: &[f64],
        ) -> Result<PageLayout, PageLayoutError> {
            let place = TextPlace {
                design: DesignLocation::new(),
                external: ExternalLocation::new(),
                kerning: KerningBlend::default(),
            };
            let units_per_em = self.font.metrics().units_per_em;
            let Self {
                font,
                shaping,
                kept,
            } = self;
            shaping
                .with_layout_font(
                    font,
                    || Ok::<_, Infallible>(source(font)),
                    place,
                    |layout_font| {
                        lay_out_page(
                            scene,
                            &NodeId::from_raw("page"),
                            units_per_em,
                            layout_font,
                            PlaceKey::new(location, None),
                            kept,
                        )
                    },
                )
                .map(|(layout, _)| layout)
        }
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
            page_node(),
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

        let layout = lay_out(vec![page_node(), column, wrapping]).unwrap();

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

        let layout = lay_out(vec![page_node(), placed]).unwrap();

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

        let layout = lay_out(vec![page_node(), run("text", "page", 0, "a"), edited]).unwrap();

        let ids: Vec<&NodeId> = layout.boxes.iter().map(|laid| &laid.id).collect();
        assert_eq!(ids, [&NodeId::from_raw("page"), &NodeId::from_raw("text")]);
    }

    #[test]
    fn only_a_page_lays_out() {
        let mut page = Page::new();
        let scene: Scene = [page_node(), run("text", "page", 0, "a")]
            .into_iter()
            .collect();
        let text = NodeId::from_raw("text");

        let not_a_page = page.shaping.with_layout_font(
            &page.font,
            || Ok::<_, Infallible>(source(&page.font)),
            TextPlace {
                design: DesignLocation::new(),
                external: ExternalLocation::new(),
                kerning: KerningBlend::default(),
            },
            |font| {
                lay_out_page(
                    &scene,
                    &text,
                    1000.0,
                    font,
                    PlaceKey::new(&[], None),
                    &mut page.kept,
                )
            },
        );

        assert_eq!(
            not_a_page.map(|_| ()),
            Err(PageLayoutError::NotAPage { id: text })
        );
    }

    /// A page with a column of two wrapping runs.
    fn two_runs() -> Vec<SceneNode> {
        let column = SceneNode {
            sizing: BoxSizing::new(Sizing::Fixed(750.0), Sizing::Hug),
            ..frame("column", LayoutDirection::Column, 0.0, 0.0)
        };
        let filling = |id, position| SceneNode {
            sizing: BoxSizing::new(Sizing::Fill, Sizing::Hug),
            ..run(id, "column", position, "aaa aaa aaa")
        };
        vec![
            page_node(),
            column,
            filling("first", 0),
            filling("second", 1),
        ]
    }

    #[test]
    fn laying_a_page_out_again_shapes_none_of_its_runs_again() {
        let mut page = Page::new();
        let scene: Scene = two_runs().into_iter().collect();

        let first = page.lay_out(&scene, &[]).unwrap();
        assert_eq!(page.kept.shapes(), 2);
        let again = page.lay_out(&scene, &[]).unwrap();

        assert_eq!(page.kept.shapes(), 2);
        assert_eq!(again, first);
    }

    #[test]
    fn a_run_whose_items_changed_is_shaped_again_alone() {
        let mut page = Page::new();
        let mut scene: Scene = two_runs().into_iter().collect();
        page.lay_out(&scene, &[]).unwrap();

        scene
            .apply_intents(&[SceneIntent::SetRunItems(SetRunItems {
                id: NodeId::from_raw("first"),
                items: Vec::new(),
            })])
            .unwrap();
        let layout = page.lay_out(&scene, &[]).unwrap();

        assert_eq!(page.kept.shapes(), 3);
        assert_eq!(lines(&layout, "first"), (Some(750.0), vec![]));
    }

    #[test]
    fn a_run_moved_keeps_its_shaped_text() {
        let mut page = Page::new();
        let mut scene: Scene = two_runs().into_iter().collect();
        page.lay_out(&scene, &[]).unwrap();

        scene
            .apply_intents(&[SceneIntent::MoveNode(MoveNode {
                id: NodeId::from_raw("first"),
                parent_id: Some(NodeId::from_raw("column")),
                index: key(2),
            })])
            .unwrap();
        page.lay_out(&scene, &[]).unwrap();

        assert_eq!(page.kept.shapes(), 2);
    }

    #[test]
    fn a_change_to_what_text_lays_out_from_or_another_place_shapes_every_run_again() {
        let mut page = Page::new();
        let scene: Scene = two_runs().into_iter().collect();
        page.lay_out(&scene, &[]).unwrap();

        // A change layout does not read keeps them.
        page.kept
            .forget_if_changed(FontChangeImpact::METADATA | FontChangeImpact::SCENE);
        page.lay_out(&scene, &[]).unwrap();
        assert_eq!(page.kept.shapes(), 2);

        page.kept.forget_if_changed(FontChangeImpact::LAYERS);
        page.lay_out(&scene, &[]).unwrap();
        assert_eq!(page.kept.shapes(), 4);

        page.lay_out(&scene, &[0.5]).unwrap();
        assert_eq!(page.kept.shapes(), 6);
    }
}
