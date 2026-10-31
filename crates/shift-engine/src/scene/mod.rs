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
//! ordered by their fractional `index` ([`index_key`]), then by id. A
//! scene copies in O(1) and changes in O(log n), like a font.

mod changes;
mod intents;
mod node;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use shift_font::{NodeId, PersistentMap, Replacement, index_key};

pub use changes::{SceneChange, SceneChangeSet};
pub use intents::{DeleteNode, MoveNode, SceneIntent, SetRunItems};
pub use node::{DEFAULT_PAGE_NAME, NodeContent, NodeKind, PageRole, SceneNode, TextItem};

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

    #[error("scene node {0} has an empty index")]
    EmptyIndex(NodeId),

    #[error("scene node {0} changed since the edit was recorded")]
    ChangeOriginMismatch(NodeId),
}

/// Where a node is filed among its siblings: by index, in shift-font's
/// [`index_key`] order, then by id.
#[derive(Clone, Debug, PartialEq, Eq)]
struct SiblingKey {
    index: String,
    id: NodeId,
}

impl Ord for SiblingKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        index_key::compare(&self.index, &other.index).then_with(|| self.id.cmp(&other.id))
    }
}

impl PartialOrd for SiblingKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl SiblingKey {
    fn of(node: &SceneNode) -> Self {
        Self {
            index: node.index.clone(),
            id: node.id.clone(),
        }
    }
}

/// A document's canvas: every node by id, and each parent's children in
/// sibling order.
#[derive(Clone, Debug, Default)]
pub struct Scene {
    nodes: PersistentMap<NodeId, Arc<SceneNode>>,
    /// Each parent's children in sibling order; `None` files the roots.
    children: PersistentMap<Option<NodeId>, PersistentMap<SiblingKey, NodeId>>,
}

impl PartialEq for Scene {
    fn eq(&self, other: &Self) -> bool {
        self.nodes.len() == other.nodes.len()
            && self
                .nodes
                .iter()
                .all(|(id, node)| other.nodes.get(id).is_some_and(|other| other == node))
    }
}

impl FromIterator<SceneNode> for Scene {
    /// A scene of `nodes` as stored, without checking their placement.
    fn from_iter<I: IntoIterator<Item = SceneNode>>(nodes: I) -> Self {
        let nodes: PersistentMap<NodeId, Arc<SceneNode>> = nodes
            .into_iter()
            .map(|node| (node.id.clone(), Arc::new(node)))
            .collect();
        let mut scene = Self {
            nodes,
            children: PersistentMap::default(),
        };
        let filed: Vec<(Option<NodeId>, SiblingKey)> = scene
            .nodes
            .values()
            .map(|node| (node.parent_id.clone(), SiblingKey::of(node)))
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
        self.nodes.get(id).map(AsRef::as_ref)
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
        let mut staged = self.clone();
        let mut changes = Vec::new();
        for intent in intents {
            staged.apply_intent(intent, &mut changes)?;
        }
        *self = staged;
        Ok(SceneChangeSet::coalesce([&SceneChangeSet { changes }]))
    }

    /// Installs a recorded change set, as undo and redo replay one. On
    /// failure the scene is as it was.
    ///
    /// # Errors
    ///
    /// Returns [`SceneError::ChangeOriginMismatch`] when a node is no longer
    /// what the change set found.
    pub fn apply_change_set(&mut self, change_set: &SceneChangeSet) -> Result<(), SceneError> {
        let mut staged = self.clone();
        for change in &change_set.changes {
            let current = staged.node(&change.id);
            if current != change.node.before.as_ref() {
                return Err(SceneError::ChangeOriginMismatch(change.id.clone()));
            }
            staged.replace(&change.id, change.node.after.clone());
        }
        *self = staged;
        Ok(())
    }

    fn apply_intent(
        &mut self,
        intent: &SceneIntent,
        changes: &mut Vec<SceneChange>,
    ) -> Result<(), SceneError> {
        match intent {
            SceneIntent::CreateNode(node) => {
                if self.node(&node.id).is_some() {
                    return Err(SceneError::NodeExists(node.id.clone()));
                }
                self.check_placement(node)?;
                self.record(node.clone(), changes);
            }
            SceneIntent::UpdateNode(node) => {
                let current = self.require(&node.id)?;
                if !current.same_kind(node) {
                    return Err(SceneError::KindChanged {
                        id: node.id.clone(),
                        expected: current.kind(),
                        found: node.kind(),
                    });
                }
                self.check_placement(node)?;
                self.record(node.clone(), changes);
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
                self.record(node, changes);
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
                    let before = self.replace(&id, None);
                    changes.push(SceneChange {
                        id,
                        node: Replacement::new(before, None),
                    });
                }
            }
            SceneIntent::SetRunItems(SetRunItems { id, items }) => {
                let mut node = self.require(id)?.clone();
                let NodeContent::TextRun { items: current, .. } = &mut node.content else {
                    return Err(SceneError::NotATextRun(id.clone()));
                };
                current.clone_from(items);
                self.record(node, changes);
            }
        }
        Ok(())
    }

    /// Puts `node` in the scene and notes the change.
    fn record(&mut self, node: SceneNode, changes: &mut Vec<SceneChange>) {
        let id = node.id.clone();
        let before = self.replace(&id, Some(node.clone()));
        changes.push(SceneChange {
            id,
            node: Replacement::new(before, Some(node)),
        });
    }

    /// Checks that `node` may sit where it says: a page at the top, any other
    /// node under one that exists, and never under itself.
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
        if self.node(parent_id).is_none() {
            return Err(SceneError::ParentNotFound {
                node: node.id.clone(),
                parent: parent_id.clone(),
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
    fn replace(&mut self, id: &NodeId, node: Option<SceneNode>) -> Option<SceneNode> {
        let before = self.nodes.remove(id);
        if let Some(previous) = &before
            && let Some(siblings) = self.children.get_mut(&previous.parent_id)
        {
            siblings.remove(&SiblingKey::of(previous));
        }
        if let Some(node) = node {
            self.children
                .get_or_default(node.parent_id.clone())
                .insert(SiblingKey::of(&node), id.clone());
            self.nodes.insert(id.clone(), Arc::new(node));
        }
        before.map(Arc::unwrap_or_clone)
    }
}
