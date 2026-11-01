//! The canvas a document's font is shown on: pages, text runs and placed
//! glyphs, as typed nodes in one tree.
//!
//! A scene sits next to the font in an editing session, never inside it, so
//! export and compilation, which read a `Font`, never see it. Edits arrive as
//! [`SceneIntent`]s and leave a [`SceneChangeSet`], each node's value before
//! and after, which goes into the same undo step and the same persisted
//! change as the font edits made with it.
//!
//! Pages are the roots; every other node descends from one. Siblings are
//! ordered by their fractional `index` ([`shift_font::index_key`]), which
//! compares as a plain string, then by id. A
//! scene copies in O(1) and changes in O(log n), like a font.

mod changes;
mod intents;
mod node;
#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use pack::Pack;

use shift_font::{NodeId, PersistentMap, Replacement};

pub use changes::{SceneChange, SceneChangeSet};
pub use intents::{CreateRun, DeleteNode, MoveNode, SceneIntent, SetRunItems, SetRunSettings};
pub use node::{
    DEFAULT_PAGE_NAME, NodeContent, NodeKind, PageRole, RunSettings, RunSettingsError, SceneNode,
    TextItem, TextRun,
};
pub use shift_layout::{Align, BoxSizing, Insets, Justify, LayoutDirection, Placement, Sizing};

/// Why a scene edit was refused. The scene is unchanged.
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum SceneError {
    #[error("no scene node {0}")]
    NodeNotFound(NodeId),

    #[error("scene node {0} already exists")]
    NodeExists(NodeId),

    #[error("scene node {node}'s parent {parent} does not exist")]
    ParentNotFound { node: NodeId, parent: NodeId },

    #[error("page {0} cannot have a parent")]
    PageWithParent(NodeId),

    /// A frame placed in a node that holds no frames: only a page or
    /// another frame lays a frame out.
    #[error(
        "frame {node} cannot be placed in {parent}, a {kind}: only a page or a frame holds frames"
    )]
    FrameInLeaf {
        node: NodeId,
        parent: NodeId,
        kind: NodeKind,
    },

    #[error("scene node {0} cannot be placed inside itself")]
    Cycle(NodeId),

    #[error("scene node {id} is a {expected}, not a {found}")]
    KindChanged {
        id: NodeId,
        expected: NodeKind,
        found: NodeKind,
    },

    #[error("scene node {0} is not a text run")]
    NotATextRun(NodeId),

    #[error("text run {id}'s settings: {source}")]
    RunSettings {
        id: NodeId,
        #[source]
        source: RunSettingsError,
    },

    #[error("scene node {0} has an empty index")]
    EmptyIndex(NodeId),

    #[error("scene node {0} changed since the edit was recorded")]
    ChangeOriginMismatch(NodeId),
}

/// Where a node is filed among its siblings: by index, which
/// [`shift_font::index_key`] makes to compare as a plain string, then by id.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct SiblingKey {
    index: String,
    id: NodeId,
}

impl SiblingKey {
    fn of(node: &SceneNode) -> Self {
        Self {
            index: node.index.clone(),
            id: node.id.clone(),
        }
    }
}

/// A number no earlier change to any scene in this process has had, so a
/// reader can tell a node it read before from one that changed, even across
/// a scene put back where an edit began.
fn next_revision() -> usize {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    NEXT.fetch_add(1, AtomicOrdering::Relaxed)
}

/// Whether a replaced node keeps the revision of a text run's items.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Items {
    /// The node's items are the ones it had: a move, or new fields.
    Kept,
    /// The node may have new items.
    Changed,
}

/// A node as the scene keeps it, with when it last changed.
#[derive(Clone, Debug)]
struct Entry {
    node: Arc<SceneNode>,
    revision: usize,
    items_revision: usize,
}

/// What a batch of intents has done so far: the changes it made, and the
/// entries they replaced, to put back if a later intent is refused.
#[derive(Default)]
struct Journal {
    changes: Vec<SceneChange>,
    previous: Vec<(NodeId, Option<Entry>)>,
}

/// A node as a reader gets it, with when it last changed: a reader keeps
/// what it built from a node while `revision` is the same, and what it built
/// from a text run's items while `items_revision` is.
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct RevisedNode {
    pub node: SceneNode,
    /// Changes whenever the node does.
    pub revision: usize,
    /// Changes whenever a text run's items may have.
    pub items_revision: usize,
}

/// A document's canvas: every node by id, and each parent's children in
/// sibling order.
#[derive(Clone, Debug, Default)]
pub struct Scene {
    nodes: PersistentMap<NodeId, Entry>,
    /// Each parent's children in sibling order; `None` files the roots.
    children: PersistentMap<Option<NodeId>, PersistentMap<SiblingKey, NodeId>>,
}

impl PartialEq for Scene {
    fn eq(&self, other: &Self) -> bool {
        self.nodes.len() == other.nodes.len()
            && self
                .nodes
                .iter()
                .all(|(id, entry)| other.node(id) == Some(entry.node.as_ref()))
    }
}

impl FromIterator<SceneNode> for Scene {
    /// A scene of `nodes` as stored, without checking their placement.
    fn from_iter<I: IntoIterator<Item = SceneNode>>(nodes: I) -> Self {
        let nodes: PersistentMap<NodeId, Entry> = nodes
            .into_iter()
            .map(|node| {
                let revision = next_revision();
                let entry = Entry {
                    node: Arc::new(node),
                    revision,
                    items_revision: revision,
                };
                (entry.node.id.clone(), entry)
            })
            .collect();
        let mut scene = Self {
            nodes,
            children: PersistentMap::default(),
        };
        let filed: Vec<(Option<NodeId>, SiblingKey)> = scene
            .nodes
            .values()
            .map(|entry| (entry.node.parent_id.clone(), SiblingKey::of(&entry.node)))
            .collect();
        for (parent, key) in filed {
            let id = key.id.clone();
            scene.children.get_or_default(parent).insert(key, id);
        }
        scene
    }
}

impl Scene {
    pub fn node(&self, id: &NodeId) -> Option<&SceneNode> {
        self.nodes.get(id).map(|entry| entry.node.as_ref())
    }

    /// When a text run's items or settings last changed, as
    /// [`RevisedNode::items_revision`] says; `None` for a node the scene
    /// does not have.
    pub fn items_revision(&self, id: &NodeId) -> Option<usize> {
        self.nodes.get(id).map(|entry| entry.items_revision)
    }

    /// Every node, in the order of [`Self::nodes`], with when it last changed.
    pub fn revised_nodes(&self) -> Vec<RevisedNode> {
        self.nodes()
            .into_iter()
            .filter_map(|node| {
                let entry = self.nodes.get(&node.id)?;
                Some(RevisedNode {
                    node: node.clone(),
                    revision: entry.revision,
                    items_revision: entry.items_revision,
                })
            })
            .collect()
    }

    /// The node with `id`, or [`SceneError::NodeNotFound`].
    ///
    /// # Errors
    ///
    /// Returns [`SceneError::NodeNotFound`] when the scene has no such node.
    pub fn require(&self, id: &NodeId) -> Result<&SceneNode, SceneError> {
        self.node(id)
            .ok_or_else(|| SceneError::NodeNotFound(id.clone()))
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// A node's children, or the roots for `None`, in sibling order.
    pub fn children(&self, parent: Option<&NodeId>) -> impl Iterator<Item = &SceneNode> {
        self.children
            .get(&parent.cloned())
            .into_iter()
            .flat_map(PersistentMap::values)
            .filter_map(|id| self.node(id))
    }

    /// The pages, in list order.
    pub fn pages(&self) -> impl Iterator<Item = &SceneNode> {
        self.children(None).filter(|node| node.is_page())
    }

    /// The nodes under `id`, each parent before its children, siblings in
    /// order; not `id` itself.
    pub fn descendants(&self, id: &NodeId) -> Vec<&SceneNode> {
        let mut found = Vec::new();
        self.walk(Some(id), &mut found);
        found
    }

    /// Every node: each root, pages included, then the nodes under it, each
    /// parent before its children, siblings in order.
    pub fn nodes(&self) -> Vec<&SceneNode> {
        let mut found = Vec::with_capacity(self.len());
        self.walk(None, &mut found);
        found
    }

    /// The page `id` is on: the page itself for a page; `None` for a node on
    /// no page or not in the scene.
    pub fn page_of(&self, id: &NodeId) -> Option<&SceneNode> {
        let mut node = self.node(id)?;
        // A scene has no cycles, so this ends; the bound guards a damaged one.
        for _ in 0..=self.len() {
            if node.is_page() {
                return Some(node);
            }
            node = self.node(node.parent_id.as_ref()?)?;
        }
        None
    }

    /// The page of the first node `changes` changed, as this scene holds it,
    /// or as its parent does for a node the changes removed.
    pub fn first_changed_page(&self, changes: &SceneChangeSet) -> Option<NodeId> {
        changes.changes.iter().find_map(|change| {
            let node = change.node.after.as_ref().or(change.node.before.as_ref())?;
            if node.is_page() {
                return Some(node.id.clone());
            }
            let parent = node.parent_id.as_ref()?;
            self.page_of(parent).map(|page| page.id.clone())
        })
    }

    /// Every glyph page and every node on one: what opening glyph tabs
    /// placed, which is navigation, never a difference from the saved
    /// document.
    pub fn glyph_page_nodes(&self) -> Vec<NodeId> {
        self.pages()
            .filter(|page| page.is_glyph_page())
            .flat_map(|page| {
                std::iter::once(page.id.clone()).chain(
                    self.descendants(&page.id)
                        .into_iter()
                        .map(|node| node.id.clone()),
                )
            })
            .collect()
    }

    /// Whether `changes` touched only glyph pages and what is on them, as
    /// opening, switching or closing a glyph tab does: navigation, which
    /// leaves the document as saved. `self` is the scene after the changes;
    /// a removed node is found through what the changes removed.
    pub fn changes_only_glyph_pages(&self, changes: &SceneChangeSet) -> bool {
        !changes.is_empty()
            && changes.changes.iter().all(|change| {
                let node = change.node.after.as_ref().or(change.node.before.as_ref());
                node.is_some_and(|node| self.is_on_glyph_page(node, changes))
            })
    }

    /// Whether `node` is a glyph page or under one, looking a parent up in
    /// this scene or, for one `changes` removed, in what it was.
    fn is_on_glyph_page(&self, node: &SceneNode, changes: &SceneChangeSet) -> bool {
        let mut node = node;
        // A scene has no cycles, so this ends; the bound guards a damaged one.
        for _ in 0..=self.len() + changes.changes.len() {
            if node.is_page() {
                return node.is_glyph_page();
            }
            let Some(parent_id) = node.parent_id.as_ref() else {
                return false;
            };
            let removed = || {
                changes
                    .changes
                    .iter()
                    .find(|change| &change.id == parent_id)
                    .and_then(|change| change.node.before.as_ref())
            };
            let Some(parent) = self.node(parent_id).or_else(removed) else {
                return false;
            };
            node = parent;
        }
        false
    }

    fn walk<'a>(&'a self, parent: Option<&NodeId>, found: &mut Vec<&'a SceneNode>) {
        for child in self.children(parent) {
            found.push(child);
            self.walk(Some(&child.id), found);
        }
    }

    /// Applies `intents` in order and returns what they changed, coalesced
    /// per node. On failure the scene is as it was.
    ///
    /// # Errors
    ///
    /// Returns the first intent's [`SceneError`]; see [`SceneIntent`].
    pub fn apply_intents(&mut self, intents: &[SceneIntent]) -> Result<SceneChangeSet, SceneError> {
        let mut journal = Journal::default();
        for intent in intents {
            if let Err(error) = self.apply_intent(intent, &mut journal) {
                self.restore(journal.previous);
                return Err(error);
            }
        }
        Ok(SceneChangeSet::coalesce([&SceneChangeSet {
            changes: journal.changes,
        }]))
    }

    /// Installs a recorded change set, as undo and redo replay one. On
    /// failure the scene is as it was.
    ///
    /// # Errors
    ///
    /// Returns [`SceneError::ChangeOriginMismatch`] when a node is no longer
    /// what the change set found.
    pub fn apply_change_set(&mut self, change_set: &SceneChangeSet) -> Result<(), SceneError> {
        let mut previous = Vec::with_capacity(change_set.changes.len());
        for change in &change_set.changes {
            if self.node(&change.id) != change.node.before.as_ref() {
                self.restore(previous);
                return Err(SceneError::ChangeOriginMismatch(change.id.clone()));
            }
            let before = self.replace(&change.id, change.node.after.clone(), Items::Changed);
            previous.push((change.id.clone(), before));
        }
        Ok(())
    }

    /// Puts back the entries a refused batch replaced, latest first, so the
    /// scene is exactly as it was, revisions included.
    fn restore(&mut self, previous: Vec<(NodeId, Option<Entry>)>) {
        for (id, entry) in previous.into_iter().rev() {
            self.put(&id, entry);
        }
    }

    fn apply_intent(
        &mut self,
        intent: &SceneIntent,
        journal: &mut Journal,
    ) -> Result<(), SceneError> {
        match intent {
            SceneIntent::CreateNode(node) => self.create(node.clone(), journal)?,
            SceneIntent::CreateRun(run) => self.create(run.node(), journal)?,
            SceneIntent::UpdateNode(node) => {
                let current = self.require(&node.id)?;
                if !current.same_kind(node) {
                    return Err(SceneError::KindChanged {
                        id: node.id.clone(),
                        expected: current.kind(),
                        found: node.kind(),
                    });
                }
                let mut node = node.clone();
                node.keep_items_of(current);
                self.check_placement(&node)?;
                self.record(node, Items::Kept, journal);
            }
            SceneIntent::MoveNode(MoveNode {
                id,
                parent_id,
                index,
            }) => {
                let mut node = self.require(id)?.clone();
                node.parent_id.clone_from(parent_id);
                node.index.clone_from(index);
                self.check_placement(&node)?;
                self.record(node, Items::Kept, journal);
            }
            SceneIntent::DeleteNode(DeleteNode { id }) => {
                self.require(id)?;
                let mut doomed: Vec<NodeId> = self
                    .descendants(id)
                    .into_iter()
                    .map(|node| node.id.clone())
                    .collect();
                // Children go before their parents.
                doomed.reverse();
                doomed.push(id.clone());
                for id in doomed {
                    self.journaled(&id, None, Items::Changed, journal);
                }
            }
            SceneIntent::SetRunItems(SetRunItems { id, items }) => {
                let mut node = self.require(id)?.clone();
                let NodeContent::TextRun { items: current, .. } = &mut node.content else {
                    return Err(SceneError::NotATextRun(id.clone()));
                };
                current.clone_from(items);
                self.record(node, Items::Changed, journal);
            }
            SceneIntent::SetRunSettings(SetRunSettings { id, settings }) => {
                let mut node = self.require(id)?.clone();
                let NodeContent::TextRun {
                    settings: current, ..
                } = &mut node.content
                else {
                    return Err(SceneError::NotATextRun(id.clone()));
                };
                settings.check().map_err(|source| SceneError::RunSettings {
                    id: id.clone(),
                    source,
                })?;
                current.clone_from(settings);
                // A run's record holds its settings, so it is new too.
                self.record(node, Items::Changed, journal);
            }
        }
        Ok(())
    }

    /// Places a new node, its id new and its placement allowed.
    fn create(&mut self, node: SceneNode, journal: &mut Journal) -> Result<(), SceneError> {
        if self.node(&node.id).is_some() {
            return Err(SceneError::NodeExists(node.id));
        }
        self.check_placement(&node)?;
        self.record(node, Items::Changed, journal);
        Ok(())
    }

    /// Puts `node` in the scene and notes the change.
    fn record(&mut self, node: SceneNode, items: Items, journal: &mut Journal) {
        let id = node.id.clone();
        self.journaled(&id, Some(node), items, journal);
    }

    /// Replaces `id`'s node with `node` (`None` removes it), noting the
    /// change and the entry it replaced.
    fn journaled(
        &mut self,
        id: &NodeId,
        node: Option<SceneNode>,
        items: Items,
        journal: &mut Journal,
    ) {
        let before = self.replace(id, node.clone(), items);
        journal.changes.push(SceneChange {
            id: id.clone(),
            node: Replacement::new(
                before.as_ref().map(|entry| entry.node.as_ref().clone()),
                node,
            ),
        });
        journal.previous.push((id.clone(), before));
    }

    /// Checks that `node` may sit where it says: a page at the top, any other
    /// node under one that exists, a frame only under a page or a frame, and
    /// never under itself.
    fn check_placement(&self, node: &SceneNode) -> Result<(), SceneError> {
        if node.index.is_empty() {
            return Err(SceneError::EmptyIndex(node.id.clone()));
        }
        let Some(parent_id) = &node.parent_id else {
            return Ok(());
        };
        if node.is_page() {
            return Err(SceneError::PageWithParent(node.id.clone()));
        }
        let Some(parent) = self.node(parent_id) else {
            return Err(SceneError::ParentNotFound {
                node: node.id.clone(),
                parent: parent_id.clone(),
            });
        };
        if node.kind() == NodeKind::Frame
            && !matches!(parent.kind(), NodeKind::Page | NodeKind::Frame)
        {
            return Err(SceneError::FrameInLeaf {
                node: node.id.clone(),
                parent: parent_id.clone(),
                kind: parent.kind(),
            });
        }
        let mut ancestor = Some(parent_id);
        while let Some(id) = ancestor {
            if id == &node.id {
                return Err(SceneError::Cycle(node.id.clone()));
            }
            ancestor = self.node(id).and_then(|node| node.parent_id.as_ref());
        }
        Ok(())
    }

    /// Replaces the node at `id` (none for `None`) and returns what was there.
    /// The node gets a new revision, and a new items revision unless `items`
    /// says they are the ones it had.
    /// Replaces `id`'s node with `node` (`None` removes it), giving it a new
    /// revision, and returns the entry it replaced.
    fn replace(&mut self, id: &NodeId, node: Option<SceneNode>, items: Items) -> Option<Entry> {
        let entry = node.map(|node| {
            let revision = next_revision();
            let items_revision = match (items, self.nodes.get(id)) {
                (Items::Kept, Some(previous)) => previous.items_revision,
                _ => revision,
            };
            Entry {
                node: Arc::new(node),
                revision,
                items_revision,
            }
        });
        self.put(id, entry)
    }

    /// Files `entry` as `id`'s (`None` removes it), keeping the sibling
    /// order in step, and returns the entry it replaced.
    fn put(&mut self, id: &NodeId, entry: Option<Entry>) -> Option<Entry> {
        let before = self.nodes.remove(id);
        if let Some(previous) = &before
            && let Some(siblings) = self.children.get_mut(&previous.node.parent_id)
        {
            siblings.remove(&SiblingKey::of(&previous.node));
        }
        if let Some(entry) = entry {
            self.children
                .get_or_default(entry.node.parent_id.clone())
                .insert(SiblingKey::of(&entry.node), id.clone());
            self.nodes.insert(id.clone(), entry);
        }
        before
    }
}
