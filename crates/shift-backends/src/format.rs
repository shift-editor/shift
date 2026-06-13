#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum FontFormat {
    Ufo,
    Glyphs,
    Designspace,
    Shift,
    Ttf,
    Otf,
}

impl FontFormat {
    pub fn name(self) -> &'static str {
        match self {
            FontFormat::Shift => "shift",
            FontFormat::Ufo => "ufo",
            FontFormat::Glyphs => "glyphs",
            FontFormat::Designspace => "designspace",
            FontFormat::Ttf => "ttf",
            FontFormat::Otf => "otf",
        }
    }
}
