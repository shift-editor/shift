use std::sync::Mutex;

use shift_editor::editor::Editor;
use shift_tauri::commands;
use shift_tauri::menu;
use shift_tauri::shortcuts;
use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            menu::create_menu(app).unwrap();

            app.manage(Mutex::new(Editor::new()));

            app.on_menu_event(move |_app, event| {
                menu::handle_menu_event(_app, &event);
            });

            // Register global shortcut for force quit
            let app_handle = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            shortcuts::handle_shortcut(&app_handle, shortcut);
                        }
                    })
                    .build(),
            )?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler!(
            commands::get_font_metrics,
            commands::get_glyph
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
