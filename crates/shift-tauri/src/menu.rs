use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    App, AppHandle,
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

    let file = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .build()?;

    let menu = MenuBuilder::new(app).item(&app_menu).item(&file).build()?;

    app.set_menu(menu)?;

    Ok(())
}

pub fn handle_menu_event(app: &AppHandle, event: &MenuEvent) {
    if event.id() == "new" {
        println!("New clicked");
        return;
    }

    if event.id() == "open" {
        app.dialog().file().pick_file(|file_path| {
            let file_path = file_path.unwrap().into_path().unwrap();
            let data = match file_path.extension() {
                Some(ext) => {
                    if ext == "ufo" {
                        Some(shift_fonts::ufo::load_ufo(
                            file_path.to_str().unwrap().to_string(),
                        ))
                    } else {
                        None
                    }
                }
                None => {
                    println!("Unknown file type");
                    None
                }
            };

            println!("Data: {:?}", data.unwrap().font_info);
        });

        return;
    }

    return;
}
