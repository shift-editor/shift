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
    /// Returns the format a file extension names, ignoring case.
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "shift" => Some(Self::Shift),
            "ufo" => Some(Self::Ufo),
            "glyphs" | "glyphspackage" => Some(Self::Glyphs),
            "designspace" => Some(Self::Designspace),
            "ttf" => Some(Self::Ttf),
            "otf" => Some(Self::Otf),
            _ => None,
        }
    }

    /// Returns the format `path`'s extension names.
    pub fn of_path(path: &std::path::Path) -> Option<Self> {
        Self::from_extension(path.extension()?.to_str()?)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Shift => "shift",
            Self::Ufo => "ufo",
            Self::Glyphs => "glyphs",
            Self::Designspace => "designspace",
            Self::Ttf => "ttf",
            Self::Otf => "otf",
        }
    }
}
