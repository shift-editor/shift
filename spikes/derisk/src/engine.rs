//! A model of the renderer's editing engine: a `shift_font::Font` that holds
//! the workspace directory (every glyph and layer identity, placeholder
//! layers) plus only the glyphs loaded so far, with the directory's component
//! references. WASM is irrelevant to correctness, so this runs natively.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use shift_font::{AppliedIntents, CoreResult, Font, FontIntent, FontIntentSet, GlyphId};
use shift_workspace::{AcquireScope, FontWorkspace};

/// How the engine decides what to load before applying.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadPolicy {
    /// Only what the renderer already shows: edited glyphs and their component closure.
    Visible,
    /// [`Engine::required_loads`]: everything native would read, from directory data alone.
    RequiredLoads,
}

pub struct Engine {
    pub font: Font,
    /// Direct component bases per glyph, for every glyph in the directory.
    /// The renderer has this as `GlyphRecord.componentBaseGlyphIds`.
    pub refs: HashMap<GlyphId, BTreeSet<GlyphId>>,
    pub loaded: HashSet<GlyphId>,
    pub policy: LoadPolicy,
    /// Glyphs loaded only because `required_loads` asked, and time spent loading.
    pub extra_loaded: usize,
    pub load_time: Duration,
}

impl Engine {
    /// Opens from the workspace's directory, as the renderer's snapshot would carry it.
    pub fn open(workspace: &FontWorkspace, policy: LoadPolicy) -> Self {
        let refs = workspace
            .glyph_component_references()
            .expect("component references")
            .into_iter()
            .map(|(glyph, bases)| (glyph, bases.into_iter().collect()))
            .collect();
        Self {
            font: workspace.font().clone(),
            refs,
            loaded: HashSet::new(),
            policy,
            extra_loaded: 0,
            load_time: Duration::ZERO,
        }
    }

    /// `roots` plus every glyph their components reference, transitively.
    pub fn closure(&self, roots: impl IntoIterator<Item = GlyphId>) -> BTreeSet<GlyphId> {
        let mut pending: Vec<GlyphId> = roots.into_iter().collect();
        let mut seen = BTreeSet::new();
        while let Some(glyph) = pending.pop() {
            if !seen.insert(glyph.clone()) {
                continue;
            }
            if let Some(bases) = self.refs.get(&glyph) {
                pending.extend(bases.iter().cloned());
            }
        }
        seen
    }

    /// Glyphs whose components reference `glyph` directly.
    pub fn dependents(&self, glyph: &GlyphId) -> Vec<GlyphId> {
        self.refs
            .iter()
            .filter(|(_, bases)| bases.contains(glyph))
            .map(|(owner, _)| owner.clone())
            .collect()
    }

    /// What applying `intents` reads, computed from the directory and the
    /// glyphs already loaded, with no layer payloads of unloaded glyphs.
    /// Mirrors `FontWorkspace::apply`'s acquisition, plus whole glyphs for
    /// glyph-level edits so a whole-glyph `before` is complete on both sides.
    pub fn required_loads(&self, intents: &[FontIntent]) -> BTreeSet<GlyphId> {
        let mut roots: Vec<GlyphId> = Vec::new();
        for intent in intents {
            let layer_ids = intent.required_layer_ids(&self.font);
            roots.extend(layer_ids.iter().filter_map(|id| self.font.glyph_id_by_layer(id)));
            match intent {
                FontIntent::UpdateGlyph { glyph_id, .. } => roots.push(glyph_id.clone()),
                FontIntent::CreateGlyphLayer { glyph_id, .. }
                | FontIntent::CloneGlyphLayer { glyph_id, .. }
                | FontIntent::MaterializeGlyphLayer { glyph_id, .. } => roots.push(glyph_id.clone()),
                _ => {}
            }
            if self.policy == LoadPolicy::Visible {
                continue;
            }
            match intent {
                FontIntent::AddComponent { base_glyph_id, .. } => roots.push(base_glyph_id.clone()),
                FontIntent::ReplaceGlyphLayerContent { components, .. } => {
                    roots.extend(components.iter().map(|component| component.base_glyph_id()));
                }
                FontIntent::DecomposeComponents {
                    layer_id,
                    component_ids,
                } => {
                    if let Some(layer) = self.font.layer(layer_id) {
                        roots.extend(component_ids.iter().filter_map(|component_id| {
                            layer.component(component_id).map(|component| component.base_glyph_id())
                        }));
                    }
                }
                _ => {}
            }
            if intent.may_move_anchors() {
                if let Some(glyph) = intent.layer_id().and_then(|id| self.font.glyph_id_by_layer(id)) {
                    roots.extend(self.dependents(&glyph));
                }
            }
        }
        self.closure(roots)
    }

    /// Loads glyphs (and their component closure) from the workspace, standing in for the async IPC fetch.
    pub fn load(&mut self, workspace: &mut FontWorkspace, glyphs: impl IntoIterator<Item = GlyphId>) {
        let wanted: Vec<GlyphId> = self
            .closure(glyphs)
            .into_iter()
            .filter(|glyph| !self.loaded.contains(glyph))
            .collect();
        if wanted.is_empty() {
            return;
        }
        let started = Instant::now();
        workspace
            .acquire_glyphs(&wanted, AcquireScope::Glyphs)
            .expect("acquire");
        let layers: Vec<Arc<_>> = wanted
            .iter()
            .filter_map(|glyph| workspace.font().glyph(glyph))
            .flat_map(|glyph| glyph.layers().values().cloned().collect::<Vec<_>>())
            .collect();
        self.font.replace_glyph_layers(layers).expect("install loaded layers");
        self.load_time += started.elapsed();
        self.loaded.extend(wanted);
    }

    /// Loads what the policy asks for, then applies with shift-font.
    pub fn apply(
        &mut self,
        workspace: &mut FontWorkspace,
        intents: &[FontIntent],
    ) -> CoreResult<AppliedIntents> {
        // Decompose's bases are read from the edited layer, so iterate to a fixed point.
        loop {
            let needed: Vec<GlyphId> = self
                .required_loads(intents)
                .into_iter()
                .filter(|glyph| !self.loaded.contains(glyph))
                .collect();
            if needed.is_empty() {
                break;
            }
            self.extra_loaded += needed.len();
            self.load(workspace, needed);
        }
        let applied = self.font.apply_intents(FontIntentSet {
            intents: intents.to_vec(),
        })?;
        self.refresh_refs(&applied);
        Ok(applied)
    }

    /// Recomputes component references of glyphs an edit touched, from their loaded layers.
    pub fn refresh_refs(&mut self, applied: &AppliedIntents) {
        let glyphs: BTreeSet<GlyphId> = applied
            .changes
            .changes
            .iter()
            .filter_map(|change| change.glyph_id())
            .collect();
        for glyph_id in glyphs {
            let Some(glyph) = self.font.glyph(&glyph_id) else {
                self.refs.remove(&glyph_id);
                continue;
            };
            let bases: BTreeSet<GlyphId> = glyph
                .layers()
                .values()
                .flat_map(|layer| layer.components_iter().map(|c| c.base_glyph_id()).collect::<Vec<_>>())
                .collect();
            if bases.is_empty() {
                self.refs.remove(&glyph_id);
            } else {
                self.refs.insert(glyph_id, bases);
            }
        }
    }
}
