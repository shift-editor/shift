//! Glyph dependency graph for component relationships.
//!
//! Directionality:
//! - `uses`: `A -> B` means glyph `A` uses `B` as a component.
//! - `used_by`: inverse index used to query "what depends on this glyph?".
//!
//! The graph is currently rebuilt from the full font model when needed.

use crate::Font;
use std::collections::{HashMap, HashSet};

/// Component dependency index across glyphs.
///
/// This graph stores both forward (`uses`) and reverse (`used_by`) edges so
/// callers can answer dependent queries efficiently.
#[derive(Default, Clone, Debug)]
pub struct DependencyGraph {
    uses: HashMap<String, HashSet<String>>,
    used_by: HashMap<String, HashSet<String>>,
}

impl DependencyGraph {
    /// Rebuilds the dependency graph from all glyph layers in `font`.
    pub fn rebuild(font: &Font) -> Self {
        let mut graph = Self::default();
        for (composite_name, glyph) in font.glyphs() {
            for layer in glyph.layers().values() {
                for component in layer.components_iter() {
                    graph.add_edge(composite_name, component.base_glyph());
                }
            }
        }
        graph
    }

    /// Adds a directed edge `composite -> component`.
    pub fn add_edge(&mut self, composite: &str, component: &str) {
        self.uses
            .entry(composite.to_string())
            .or_default()
            .insert(component.to_string());
        self.used_by
            .entry(component.to_string())
            .or_default()
            .insert(composite.to_string());
    }

    /// Returns all glyph names that (transitively) depend on `glyph_name`.
    ///
    /// The root `glyph_name` is excluded from the output, even if cycles are
    /// present.
    pub fn dependents_recursive(&self, glyph_name: &str) -> HashSet<String> {
        let mut result = HashSet::new();
        let mut stack = vec![glyph_name.to_string()];

        while let Some(current) = stack.pop() {
            let Some(dependents) = self.used_by.get(&current) else {
                continue;
            };

            for dependent in dependents {
                if dependent == glyph_name {
                    continue;
                }
                if result.insert(dependent.clone()) {
                    stack.push(dependent.clone());
                }
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Font, Glyph, GlyphLayer};
    use shift_ir::Component;

    #[test]
    fn recursive_dependents_includes_transitive_glyphs() {
        let mut font = Font::new();
        let layer_id = font.default_layer_id();

        let mut a = Glyph::new("A".to_string());
        a.set_layer(layer_id, GlyphLayer::with_width(600.0));

        let mut aacute = Glyph::new("Aacute".to_string());
        let mut aacute_layer = GlyphLayer::with_width(600.0);
        aacute_layer.add_component(Component::new("A".to_string()));
        aacute.set_layer(layer_id, aacute_layer);

        let mut aacute_alt = Glyph::new("Aacute.alt".to_string());
        let mut aacute_alt_layer = GlyphLayer::with_width(600.0);
        aacute_alt_layer.add_component(Component::new("Aacute".to_string()));
        aacute_alt.set_layer(layer_id, aacute_alt_layer);

        font.insert_glyph(a);
        font.insert_glyph(aacute);
        font.insert_glyph(aacute_alt);

        let graph = DependencyGraph::rebuild(&font);
        let dependents = graph.dependents_recursive("A");

        assert!(dependents.contains("Aacute"));
        assert!(dependents.contains("Aacute.alt"));
    }
}
