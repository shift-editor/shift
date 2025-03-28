use std::sync::Mutex;

use shift_editor::editor::Editor;
use shift_events::events::{FontCompiledEvent, FontLoadedEvent};
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    path::{self, PathResolver},
    App, AppHandle, Emitter, Manager,
};

use tauri_plugin_dialog::DialogExt;

pub fn create_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let about = AboutMetadataBuilder::new().name(Some("Shift")).build();

    let app_menu = SubmenuBuilder::new(app, "Shift")
        .about_with_text("About Shift", Some(about))
        .build()?;

    let new = MenuItemBuilder::new("New")
        .id("new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let open = MenuItemBuilder::new("Open")
        .id("open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let quit = MenuItemBuilder::new("Quit")
        .id("quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let compile = MenuItemBuilder::new("Compile").id("compile").build(app)?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .item(&compile)
        .item(&quit)
        .build()?;

    let menu = MenuBuilder::new(app).item(&app_menu).item(&file).build()?;

    app.set_menu(menu)?;

    Ok(())
}

pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    if event.id() == "new" {
        return;
    }

    if event.id() == "quit" {
        app.exit(0);
        return;
    }

    if event.id() == "open" {
        let app_handle = app.clone();

        app.dialog()
            .file()
            .add_filter("Font", &["ttf", "otf", "ufo"])
            .pick_file(move |file_path| {
                let editor = app_handle.state::<Mutex<Editor>>();
                let file_path = file_path.unwrap().into_path().unwrap();

                editor
                    .lock()
                    .unwrap()
                    .read_font(&file_path.to_str().unwrap());

                app_handle
                    .emit(
                        "font:loaded",
                        FontLoadedEvent {
                            file_name: file_path.file_name().unwrap().to_str().unwrap().to_string(),
                        },
                    )
                    .unwrap();
            });
    }

    if event.id() == "compile" {
        let app_handle = app.clone();
        let editor = app_handle.state::<Mutex<Editor>>();
        let editor_guard = editor.lock().unwrap();
        let font_path = editor_guard.font_path();
        let font_name = font_path.file_name().unwrap().to_str().unwrap();
        let font_path_str = font_path.to_str().unwrap();
        let data_dir = app.path().download_dir().unwrap();

        let result = shift_font::otf_ttf::compile_font(font_path_str, &data_dir, font_name);
        if result.is_err() {
            println!("Failed to compile font: {}", result.err().unwrap());
        }

        app_handle
            .emit(
                "font:compiled",
                FontCompiledEvent {
                    file_name: font_path.file_name().unwrap().to_str().unwrap().to_string(),
                    font_path: font_path_str.to_string(),
                },
            )
            .unwrap();
    }

    return;
}
