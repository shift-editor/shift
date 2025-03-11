use std::sync::Mutex;

use shift_editor::editor::Editor;
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    App, AppHandle, Manager,
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

    let file = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
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

        app.dialog().file().pick_file(move |file_path| {
            let editor = app_handle.state::<Mutex<Editor>>();
            let file_path = file_path.unwrap().into_path().unwrap();

            editor
                .lock()
                .unwrap()
                .read_font(&file_path.to_str().unwrap());
        });
    }

    return;
}
