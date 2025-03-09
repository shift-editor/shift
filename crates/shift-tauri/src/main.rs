use shift_tauri::commands;
use shift_tauri::menu;
// Prevents additional console window on Windows in release, DO NOT REMOVE!!

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            menu::create_menu(app).unwrap();

            app.on_menu_event(move |_app, event| {
                menu::handle_menu_event(_app, &event);
            });

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler!(commands::get_glyph))
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
