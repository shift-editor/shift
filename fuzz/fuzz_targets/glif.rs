#![no_main]

//! A one-glyph UFO whose `.glif` is the input.

use std::path::PathBuf;
use std::sync::OnceLock;

use libfuzzer_sys::fuzz_target;

const METAINFO: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>creator</key><string>shift-fuzz</string>
<key>formatVersion</key><integer>3</integer>
</dict></plist>
"#;

const CONTENTS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>a</key><string>a.glif</string>
</dict></plist>
"#;

const LAYERS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array>
<array><string>public.default</string><string>glyphs</string></array>
</array></plist>
"#;

fn ufo() -> &'static PathBuf {
    static UFO: OnceLock<PathBuf> = OnceLock::new();
    UFO.get_or_init(|| {
        let ufo = shift_fuzz::scratch().join("Input.ufo");
        std::fs::create_dir_all(ufo.join("glyphs")).expect("a UFO directory");
        shift_fuzz::write(&ufo.join("metainfo.plist"), METAINFO.as_bytes());
        shift_fuzz::write(&ufo.join("layercontents.plist"), LAYERS.as_bytes());
        shift_fuzz::write(&ufo.join("glyphs/contents.plist"), CONTENTS.as_bytes());
        ufo
    })
}

fuzz_target!(|bytes: &[u8]| {
    let ufo = ufo();
    shift_fuzz::write(&ufo.join("glyphs/a.glif"), bytes);
    shift_fuzz::exercise(ufo);
});
