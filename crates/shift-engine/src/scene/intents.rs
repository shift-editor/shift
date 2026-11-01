//! The scene edits a caller asks for.

use pack::Pack;
use shift_font::NodeId;

use super::{RunSettings, SceneNode, TextItem};

/// One edit to the scene. Each applies to the scene as the edits before it in
/// the same call left it.
#[derive(Clone, Debug, PartialEq, Pack)]
pub enum SceneIntent {
    /// Places a new node; its id must be new, and its parent, when it has
    /// one, must exist. A page has no parent.
    CreateNode(SceneNode),
    /// Replaces a node with a new value of the same kind, under the same id:
    /// its fields, placement or place among its siblings. A text run keeps its
    /// items and settings; [`SceneIntent::SetRunItems`] and
    /// [`SceneIntent::SetRunSettings`] change them.
    UpdateNode(SceneNode),
    /// Puts a node under another parent, or at another place among its
    /// siblings, keeping everything else.
    MoveNode(MoveNode),
    /// Removes a node and every node under it.
    DeleteNode(DeleteNode),
    /// Replaces a text run's items.
    SetRunItems(SetRunItems),
    /// Replaces how a text run is shaped and set.
    SetRunSettings(SetRunSettings),
}

/// See [`SceneIntent::MoveNode`].
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct MoveNode {
    pub id: NodeId,
    pub parent_id: Option<NodeId>,
    pub index: String,
}

/// See [`SceneIntent::DeleteNode`].
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct DeleteNode {
    pub id: NodeId,
}

/// See [`SceneIntent::SetRunItems`].
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct SetRunItems {
    pub id: NodeId,
    pub items: Vec<TextItem>,
}

/// See [`SceneIntent::SetRunSettings`].
#[derive(Clone, Debug, PartialEq, Pack)]
pub struct SetRunSettings {
    pub id: NodeId,
    pub settings: RunSettings,
}

impl SceneIntent {
    /// The node this intent names.
    pub fn node_id(&self) -> &NodeId {
        match self {
            Self::CreateNode(node) | Self::UpdateNode(node) => &node.id,
            Self::MoveNode(MoveNode { id, .. })
            | Self::DeleteNode(DeleteNode { id })
            | Self::SetRunItems(SetRunItems { id, .. })
            | Self::SetRunSettings(SetRunSettings { id, .. }) => id,
        }
    }
}
