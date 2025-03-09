use crate::font::Font;

trait FontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String>;
    fn write_font(&self, font: &Font, path: &str) -> Result<(), String>;
}

struct FontService {
    adaptor: Box<dyn FontAdaptor>,
}
