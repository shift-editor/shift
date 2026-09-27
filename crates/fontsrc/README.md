# fontsrc

Read and write authored font sources in Rust and TypeScript.

The project is incubating in the Shift monorepo before moving to [shift-editor/fontsrc](https://github.com/shift-editor/fontsrc). Its format APIs do not depend on Shift.

```rust
use fontsrc::ufo::{DataRequest, Font, FontSource};

fn load(source: &dyn FontSource) -> Result<Font, fontsrc::ufo::FontLoadError> {
    Font::load_from_source(&DataRequest::all(), source)
}
```

The format modules expose UFO, Designspace, and Glyphs-native values. Multi-file hosts implement `fontsrc::FileSource` over a native directory, immutable byte map, archive, browser selection, or remote project tree. Browser/Node adapters and TypeScript bindings remain independent layers.
