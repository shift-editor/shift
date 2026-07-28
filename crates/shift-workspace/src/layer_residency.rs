use std::collections::HashSet;

use shift_font::{Font, LayerId};

/// Tracks which directory-listed layers do not currently carry authored
/// geometry in the live font projection.
///
/// Directory placeholders are an implementation detail of the current lazy
/// workspace. Keeping every residency transition here prevents a valid empty
/// layer from being mistaken for loaded authored state at persistence
/// boundaries.
#[derive(Default)]
pub(crate) struct LayerResidency {
    unloaded: HashSet<LayerId>,
}

impl LayerResidency {
    pub(crate) fn with_unloaded(layer_ids: impl IntoIterator<Item = LayerId>) -> Self {
        Self {
            unloaded: layer_ids.into_iter().collect(),
        }
    }

    pub(crate) fn is_unloaded(&self, layer_id: &LayerId) -> bool {
        self.unloaded.contains(layer_id)
    }

    pub(crate) fn requested_unloaded(
        &self,
        layer_ids: impl IntoIterator<Item = LayerId>,
    ) -> Vec<LayerId> {
        layer_ids
            .into_iter()
            .filter(|layer_id| self.is_unloaded(layer_id))
            .collect()
    }

    pub(crate) fn unloaded_layer_ids(&self) -> impl Iterator<Item = &LayerId> {
        self.unloaded.iter()
    }

    pub(crate) fn mark_loaded(&mut self, layer_ids: impl IntoIterator<Item = LayerId>) {
        for layer_id in layer_ids {
            self.unloaded.remove(&layer_id);
        }
    }

    pub(crate) fn mark_unloaded(&mut self, layer_ids: impl IntoIterator<Item = LayerId>) {
        self.unloaded.extend(layer_ids);
    }

    pub(crate) fn retain_directory_layers(&mut self, font: &Font) {
        self.unloaded
            .retain(|layer_id| font.layer(layer_id.clone()).is_some());
    }

    pub(crate) fn loaded_count(&self, directory_layer_count: usize) -> usize {
        directory_layer_count.saturating_sub(self.unloaded.len())
    }
}
