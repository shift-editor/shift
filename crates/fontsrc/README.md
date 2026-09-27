# fontsrc

Read and write authored font sources in Rust and TypeScript.

The project is incubating in the Shift monorepo before moving to [shift-editor/fontsrc](https://github.com/shift-editor/fontsrc). Its format APIs do not depend on Shift.

```rust
use fontsrc::ufo::{DataRequest, Font, FontSource};

fn load(source: &dyn FontSource) -> Result<Font, fontsrc::ufo::FontLoadError> {
    Font::load_from_source(&DataRequest::all(), source)
}
```

The first format module exposes UFO-native values and Norad's source/sink boundaries. Designspace, Glyphs, browser/Node adapters, and TypeScript bindings will follow as independent layers.
