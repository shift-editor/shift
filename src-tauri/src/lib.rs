use font_kit::{outline::OutlineSink, source::SystemSource};
use pathfinder_geometry::line_segment::LineSegment2F;
use pathfinder_geometry::vector::Vector2F;
use serde::Serialize;
use tauri_plugin_log::{Target, TargetKind};

#[derive(Serialize)]
struct Vector2FWrapper {
    x: f32,
    y: f32,
}

#[derive(Serialize)]
struct LineSegment2FWrapper {
    from: Vector2FWrapper,
    to: Vector2FWrapper,
}

impl From<Vector2F> for Vector2FWrapper {
    fn from(v: Vector2F) -> Self {
        Vector2FWrapper { x: v.x(), y: v.y() }
    }
}

impl From<LineSegment2F> for LineSegment2FWrapper {
    fn from(v: LineSegment2F) -> Self {
        LineSegment2FWrapper {
            from: Vector2FWrapper {
                x: v.from_x(),
                y: v.from_y(),
            },
            to: Vector2FWrapper {
                x: v.to_x(),
                y: v.to_y(),
            },
        }
    }
}

#[derive(Debug, Clone)]
enum Command {
    MoveTo(Vector2F),
    LineTo(Vector2F),
    QuadTo(Vector2F, Vector2F),
    CubeTo(LineSegment2F, Vector2F),
    Close,
}

#[derive(Serialize)]
enum SerialisedCommand {
    MoveTo(Vector2FWrapper),
    LineTo(Vector2FWrapper),
    QuadTo(Vector2FWrapper, Vector2FWrapper),
    CubeTo(LineSegment2FWrapper, Vector2FWrapper),
    Close,
}
struct PathSink {
    commands: Vec<Command>,
}

impl PathSink {
    fn new() -> Self {
        PathSink {
            commands: Vec::new(),
        }
    }

    fn print_commands(&self) {
        for (i, cmd) in self.commands.iter().enumerate() {
            println!("Step {}: {:?}", i, cmd);
        }
    }
}

impl OutlineSink for PathSink {
    fn move_to(&mut self, to: Vector2F) {
        self.commands.push(Command::MoveTo(to));
    }
    // Draws a line to a point.
    fn line_to(&mut self, to: Vector2F) {
        self.commands.push(Command::LineTo(to));
    }
    // Draws a quadratic Bézier curve to a point.
    fn quadratic_curve_to(&mut self, ctrl: Vector2F, to: Vector2F) {
        self.commands.push(Command::QuadTo(ctrl, to));
    }
    // Draws a cubic Bézier curve to a point.
    fn cubic_curve_to(&mut self, ctrl: LineSegment2F, to: Vector2F) {
        self.commands.push(Command::CubeTo(ctrl, to));
    }
    // Closes the path, returning to the first point in it.
    fn close(&mut self) {
        self.commands.push(Command::Close);
    }
}

impl From<Command> for SerialisedCommand {
    fn from(c: Command) -> Self {
        match c {
            Command::MoveTo(v) => SerialisedCommand::MoveTo(v.into()),
            Command::LineTo(v) => SerialisedCommand::LineTo(v.into()),
            Command::QuadTo(ctrl, to) => SerialisedCommand::QuadTo(ctrl.into(), to.into()),
            Command::CubeTo(ctrl, to) => SerialisedCommand::CubeTo(ctrl.into(), to.into()),
            Command::Close => SerialisedCommand::Close,
        }
    }
}

#[tauri::command]
fn get_family_name(name: &str) -> Result<Vec<SerialisedCommand>, String> {
    let handle = SystemSource::new().select_family_by_name(name).unwrap();
    let font = handle.fonts()[0].load().unwrap();

    let id = font.glyph_for_char('a').unwrap();

    let mut sink = PathSink::new();
    font.outline(id, font_kit::hinting::HintingOptions::None, &mut sink)
        .unwrap();

    let commands = sink
        .commands
        .iter()
        .map(|cmd| cmd.clone().into())
        .collect::<Vec<SerialisedCommand>>();

    log::info!(
        "Commands JSON: {}",
        serde_json::to_string(&commands).unwrap()
    );
    Ok(commands)
}

#[tauri::command]
fn test(name: &str) -> Result<String, String> {
    Ok("HEY FROM THE BACK".into())
}

#[tauri::command]
fn system_colour() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_family_name, test])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
