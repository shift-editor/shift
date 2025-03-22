use std::sync::Mutex;

use shift_editor::editor::Editor;
use shift_font::{font::Metrics, glyph::Glyph};
use tauri::State;

#[tauri::command]
pub fn get_font_metrics(state: State<'_, Mutex<Editor>>) -> Metrics {
    let editor = state.lock().unwrap();
    editor.get_font_metrics()
}

#[tauri::command]
pub fn get_glyph(state: State<'_, Mutex<Editor>>, unicode: u32) -> Glyph {
    let mut editor = state.lock().unwrap();
    editor.get_glyph(unicode).clone()
}
