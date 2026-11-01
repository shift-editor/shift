//! A scene for an editor with no editing engine, such as a preview of a font
//! file or an in-memory session: the same shift-engine scene an engine
//! session holds, with nothing persisted and no undo history.

use std::cell::RefCell;

use shift_engine::scene::{Scene, SceneIntent, SceneNode};
use wasm_bindgen::prelude::wasm_bindgen;

thread_local! {
    static SCENES: RefCell<Vec<Option<Scene>>> = const { RefCell::new(Vec::new()) };
}

/// Scenes held apart from any editing engine, each named by a handle.
#[pack::interface]
pub trait Scenes {
    /// Opens an empty scene and returns its handle, until `releaseScene`.
    fn open_scene(&self) -> usize;
    /// Applies `intents` in order, as an engine session applies scene
    /// intents; null on success, else why the first refused intent was
    /// refused, the scene then as it was. Refused for an unknown handle.
    fn apply_scene(&self, handle: usize, intents: Vec<SceneIntent>) -> Option<String>;
    /// Every node, each root then the nodes under it, each parent before its
    /// children, siblings in order; empty for an unknown handle.
    fn scene_nodes(&self, handle: usize) -> Vec<SceneNode>;
}

/// The scenes [`Scenes`] calls.
pub struct HeldScenes;

impl Scenes for HeldScenes {
    fn open_scene(&self) -> usize {
        SCENES.with_borrow_mut(|scenes| {
            scenes.push(Some(Scene::default()));
            scenes.len() - 1
        })
    }

    fn apply_scene(&self, handle: usize, intents: Vec<SceneIntent>) -> Option<String> {
        SCENES.with_borrow_mut(|scenes| {
            let Some(scene) = scenes.get_mut(handle).and_then(Option::as_mut) else {
                return Some(format!("no scene {handle}"));
            };
            scene
                .apply_intents(&intents)
                .err()
                .map(|error| error.to_string())
        })
    }

    fn scene_nodes(&self, handle: usize) -> Vec<SceneNode> {
        SCENES.with_borrow(|scenes| {
            scenes
                .get(handle)
                .and_then(Option::as_ref)
                .map(|scene| scene.nodes().into_iter().cloned().collect())
                .unwrap_or_default()
        })
    }
}

/// Runs one [`Scenes`] method for the editor's generated `Scenes` class.
#[wasm_bindgen(js_name = scenesRequest)]
pub fn request(
    method: u32,
    input: &[f64],
    #[wasm_bindgen(unchecked_param_type = "readonly Uint8Array[] | undefined")] blobs: Option<
        js_sys::Array,
    >,
) -> Vec<f64> {
    crate::blobs::answer(blobs, |blobs, names| {
        scenes_request(&HeldScenes, method, input, blobs, names)
    })
}

/// Forgets a scene. Releasing an unknown handle does nothing.
#[wasm_bindgen(js_name = releaseScene)]
pub fn release_scene(handle: u32) {
    SCENES.with_borrow_mut(|scenes| {
        if let Some(slot) = usize::try_from(handle)
            .ok()
            .and_then(|index| scenes.get_mut(index))
        {
            *slot = None;
        }
    });
}
