#![no_main]

//! A designspace document as the input, beside a valid one-glyph UFO that
//! its sources can name as `Source.ufo`.

use std::path::PathBuf;
use std::sync::OnceLock;

use libfuzzer_sys::fuzz_target;

const METAINFO: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>creator</key><string>shift-fuzz</string>
<key>formatVersion</key><integer>3</integer>
</dict></plist>
"#;

const CONTENTS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>a</key><string>a.glif</string></dict></plist>
"#;

const GLIF: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<glyph name="a" format="2">
  <advance width="500"/>
  <unicode hex="0061"/>
  <outline>
    <contour>
      <point x="0" y="0" type="line"/>
      <point x="0" y="500" type="line"/>
      <point x="250" y="700"/>
      <point x="500" y="500" type="qcurve"/>
      <point x="500" y="0" type="line"/>
    </contour>
  </outline>
</glyph>
"#;

fn designspace() -> &'static PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let dir = shift_fuzz::scratch();
        let ufo = dir.join("Source.ufo");
        std::fs::create_dir_all(ufo.join("glyphs")).expect("a UFO directory");
        shift_fuzz::write(&ufo.join("metainfo.plist"), METAINFO.as_bytes());
        shift_fuzz::write(&ufo.join("glyphs/contents.plist"), CONTENTS.as_bytes());
        shift_fuzz::write(&ufo.join("glyphs/a.glif"), GLIF.as_bytes());
        dir.join("Input.designspace")
    })
}

fuzz_target!(|bytes: &[u8]| {
    let path = designspace();
    shift_fuzz::write(path, bytes);
    shift_fuzz::exercise(path);
});
