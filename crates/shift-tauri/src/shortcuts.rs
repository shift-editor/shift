use crate::core;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

pub fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut) {
    if shortcut.matches(Modifiers::META, Code::KeyQ) {
        println!("Force quit triggered via global shortcut");
        core::handle_quit(app);
    }
}
