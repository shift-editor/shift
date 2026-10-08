//! The face for everything on a proof that is not the font being proofed:
//! the header, section titles, captions, and metric labels.
//!
//! Labels must not depend on the proofed font, which may not draw Latin yet.
//! This is an ASCII subset of JetBrains Mono (SIL OFL 1.1), the editor's
//! numeric and code face; see `THIRD_PARTY_NOTICES.md`.

use shift_specimen::shaping::{ShapedRun, ShapingFont};

use crate::layout::{Rgb, RunMark};

static UI_FONT: &[u8] = include_bytes!("../assets/JetBrainsMono-Proof.ttf");

/// How a piece of UI text is set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TextStyle {
    pub size: f32,
    pub bold: bool,
    pub color: Rgb,
    pub class: &'static str,
}

/// Which edge of a piece of text sits at the given x.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Align {
    Left,
    Right,
    Center,
}

pub(crate) struct UiType {
    regular: ShapingFont<'static>,
    bold: ShapingFont<'static>,
}

impl UiType {
    pub fn new() -> Self {
        let regular = ShapingFont::new(UI_FONT).expect("the embedded UI font is valid");
        let bold = regular
            .at(&[("wght".to_string(), 700.0)])
            .expect("the embedded UI font has a wght axis");
        Self { regular, bold }
    }

    fn shape(&self, text: &str, style: TextStyle) -> (ShapedRun, f32) {
        let font = if style.bold {
            &self.bold
        } else {
            &self.regular
        };
        let scale = style.size / f32::from(font.metrics().units_per_em);
        (font.shape(text), scale)
    }

    /// Width of `text` in pixels.
    pub fn width(&self, text: &str, style: TextStyle) -> f32 {
        let (run, scale) = self.shape(text, style);
        run.advance * scale
    }

    /// `text` cut short with an ellipsis so it fits `max_width` pixels.
    pub fn fit(&self, text: &str, style: TextStyle, max_width: f32) -> String {
        if self.width(text, style) <= max_width {
            return text.to_string();
        }
        let mut characters: Vec<char> = text.chars().collect();
        while !characters.is_empty() {
            characters.pop();
            let candidate: String = characters.iter().collect::<String>() + "…";
            if self.width(&candidate, style) <= max_width {
                return candidate;
            }
        }
        String::new()
    }

    /// Sets `text` with its `align` edge at `x` on `baseline`.
    pub fn mark(
        &self,
        text: &str,
        style: TextStyle,
        x: f32,
        baseline: f32,
        align: Align,
    ) -> RunMark {
        let (run, scale) = self.shape(text, style);
        let width = run.advance * scale;
        let x = match align {
            Align::Left => x,
            Align::Right => x - width,
            Align::Center => x - width / 2.0,
        };
        RunMark {
            class: style.class,
            text: text.to_string(),
            color: style.color,
            x,
            baseline,
            scale,
            segments: run
                .glyphs
                .into_iter()
                .flat_map(|glyph| glyph.segments)
                .collect(),
        }
    }
}
