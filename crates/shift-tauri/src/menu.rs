use tauri::{
    menu::{MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder},
    App, WebviewWindow,
};

pub fn create_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_menu = SubmenuBuilder::new(app, "Shift").build()?;

    let new = MenuItemBuilder::new("New")
        .id("new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let file = SubmenuBuilder::new(app, "File").item(&new).build()?;

    let menu = MenuBuilder::new(app).item(&app_menu).item(&file).build()?;

    // Set the menu
    app.set_menu(menu)?;

    Ok(())
}

pub fn handle_menu_event(event: &MenuEvent) {
    if event.id() == "new" {
        println!("New clicked");
        return;
    }

    return;
}
