use serde::Serialize;
use skrifa::outline::OutlinePen;

use super::contour::Contour;

#[derive(Debug, Clone, Serialize)]
pub enum PathCommand {
    MoveTo(f32, f32),
    LineTo(f32, f32),
    CubicTo(f32, f32, f32, f32, f32, f32),
    QuadraticTo(f32, f32, f32, f32),
    Close,
}

pub struct ShiftPen {
    commands: Vec<PathCommand>,
    contours: Vec<Contour>,
}

impl ShiftPen {
    pub fn new() -> Self {
        Self {
            commands: Vec::new(),
            contours: Vec::new(),
        }
    }

    pub fn commands(&self) -> Vec<PathCommand> {
        self.commands.clone()
    }
}

impl OutlinePen for ShiftPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.commands.push(PathCommand::MoveTo(x, y));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.commands.push(PathCommand::LineTo(x, y));
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.commands
            .push(PathCommand::CubicTo(cx0, cy0, cx1, cy1, x, y));
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.commands.push(PathCommand::QuadraticTo(cx0, cy0, x, y));
    }

    fn close(&mut self) {
        self.commands.push(PathCommand::Close);
    }
}


