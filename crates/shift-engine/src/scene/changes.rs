//! Reversible scene edits: each node's value before and after.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use shift_font::{NodeId, Replacement};

use super::SceneNode;

/// One node's value before and after an edit; `None` is no node with that id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SceneChange {
    pub id: NodeId,
    pub node: Replacement<Option<SceneNode>>,
}

/// What one scene edit changed, node by node, in the order it changed them.
///
/// A set installs every change at once: a child may arrive before its parent.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SceneChangeSet {
    pub changes: Vec<SceneChange>,
}

impl SceneChangeSet {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }

    /// The change set that takes this one back.
    #[must_use]
    pub fn inverted(&self) -> Self {
        Self {
            changes: self
                .changes
                .iter()
                .rev()
                .map(|change| SceneChange {
                    id: change.id.clone(),
                    node: Replacement::new(change.node.after.clone(), change.node.before.clone()),
                })
                .collect(),
        }
    }

    /// The ids of the nodes this set changes, in the order it first changes them.
    pub fn node_ids(&self) -> impl Iterator<Item = &NodeId> {
        self.changes.iter().map(|change| &change.id)
    }

    /// Several change sets made one after another as one: each node's value
    /// before the first and after the last; a node they leave as it was is
    /// left out.
    pub fn coalesce<'a>(sets: impl IntoIterator<Item = &'a Self>) -> Self {
        let mut order: Vec<NodeId> = Vec::new();
        let mut by_id: HashMap<NodeId, Replacement<Option<SceneNode>>> = HashMap::new();
        for change in sets.into_iter().flat_map(|set| &set.changes) {
            match by_id.get_mut(&change.id) {
                Some(replacement) => replacement.after.clone_from(&change.node.after),
                None => {
                    order.push(change.id.clone());
                    by_id.insert(change.id.clone(), change.node.clone());
                }
            }
        }
        let changes = order
            .into_iter()
            .filter_map(|id| {
                let node = by_id.remove(&id)?;
                (node.before != node.after).then_some(SceneChange { id, node })
            })
            .collect();
        Self { changes }
    }
}
