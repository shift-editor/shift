use tauri::AppHandle;

pub fn handle_quit(app: &AppHandle) {
    // Add any cleanup logic here before quitting
    println!("Quitting Shift font editor...");

    // You can add save prompts, cleanup, etc. here
    // For now, just exit
    app.exit(0);
}
