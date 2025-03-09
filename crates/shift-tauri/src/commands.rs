#[tauri::command]
pub fn get_glyph(char: String) -> Result<(), String> {
    Ok(())
}
