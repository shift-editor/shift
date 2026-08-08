use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::font_source::projection::resolve_projection_closure;
use crate::font_source::{
    malformed, FontDirectory, FontImporter, FontReadError, FontSource, GlyphIndex, ProjectedGlyph,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};

use super::glif::{glyph_directory, project_glif_glyph, retained_layer, RetainedUfoLayer};
use super::{load_header, read_ufo_layer_directories, stream_retained, UfoLayerDirectory};

/// Retained paths and glyph bytes for one UFO.
pub struct UfoFont {
    path: PathBuf,
    directory: FontDirectory,
    glyphs_by_name: HashMap<String, GlyphIndex>,
    sources: Vec<(Vec<f64>, Box<[RetainedUfoLayer]>)>,
    layers: Arc<[UfoLayerDirectory]>,
}

impl UfoFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        if !matches!(
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("ufo")
        ) {
            return Err(FontReadError::UnsupportedFormat {
                path: path.to_path_buf(),
            });
        }

        let header = load_header(path).map_err(|error| malformed(path, error.to_string()))?;
        let layers: Arc<[UfoLayerDirectory]> = Arc::from(
            read_ufo_layer_directories(path).map_err(|error| malformed(path, error.to_string()))?,
        );
        let glyph_layers = layers
            .iter()
            .map(|layer| layer.glyphs.clone())
            .collect::<Vec<_>>();
        let (directory, glyphs_by_name) =
            FontDirectory::from_font(FontFormat::Ufo, &header, glyph_directory(&glyph_layers)?)?;
        let retained_layers = layers
            .iter()
            .map(|layer| retained_layer(&directory, layer.glyphs.clone()))
            .collect::<Result<Vec<_>, _>>()?
            .into_boxed_slice();

        Ok(Self {
            path: path.to_path_buf(),
            directory,
            glyphs_by_name,
            sources: vec![(Vec::new(), retained_layers)],
            layers,
        })
    }
}

impl FontSource for UfoFont {
    fn directory(&self) -> &FontDirectory {
        &self.directory
    }

    fn glyph(&self, glyph: GlyphIndex) -> Result<ProjectedGlyph, FontReadError> {
        resolve_projection_closure(
            &self.directory,
            glyph,
            "GLIF projection root is unavailable",
            |glyph| {
                project_glif_glyph(
                    &self.path,
                    &self.glyphs_by_name,
                    &self.sources,
                    0,
                    &[],
                    glyph,
                )
            },
        )
    }
}

impl FontImporter for UfoFont {
    fn begin_import(&self) -> BackendResult<FontImport> {
        let (header, stream) = stream_retained(&self.path, self.layers.clone())
            .map_err(|source| BackendError::load(FontFormat::Ufo, self.path.clone(), source))?;
        Ok(FontImport::new(
            header,
            Box::new(stream),
            FontFormat::Ufo,
            self.path.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;

    use super::*;
    use crate::font_source::{FontImporter, PointProvenance};

    fn fixture(path: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts")
            .join(path)
    }

    #[test]
    fn ufo_directory_and_projection_need_no_shift_identity() {
        let font = UfoFont::open(&fixture("mutatorsans/MutatorSansLightCondensed.ufo")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let projected = font.glyph(glyph.index).unwrap();

        assert_eq!(projected.root.glyph, glyph.index);
        assert!(!projected.root.fallback.contours.is_empty());
        assert!(projected
            .root
            .fallback
            .contours
            .iter()
            .flat_map(|contour| contour.points.iter())
            .all(|point| matches!(
                point.provenance,
                PointProvenance::Native {
                    ttf_point_index: None
                } | PointProvenance::Implied
            )));
    }

    #[test]
    fn ufo_layer_only_glyph_matches_authored_import() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("LayerOnly.ufo");
        copy_directory(
            &fixture("mutatorsans/MutatorSansLightCondensed.ufo"),
            &copied,
        );
        add_layer_only_glyph(&copied, "glyphs.background", "S_.closed.glif");

        let font = UfoFont::open(&copied).unwrap();
        assert_projection_and_import_contain_layer_only(&font);
    }

    #[test]
    fn ufo_projection_uses_retained_bytes_after_source_removal() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("Removed.ufo");
        copy_directory(
            &fixture("mutatorsans/MutatorSansLightCondensed.ufo"),
            &copied,
        );
        let font = UfoFont::open(&copied).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .unwrap()
            .index;
        let expected = font.glyph(glyph).unwrap();
        fs::remove_dir_all(&copied).unwrap();

        assert_eq!(font.glyph(glyph).unwrap(), expected);
    }

    fn assert_projection_and_import_contain_layer_only(font: &impl FontImporter) {
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "layerOnly")
            .expect("retained directory should include the layer-only glyph");
        assert!(!font
            .glyph(glyph.index)
            .unwrap()
            .root
            .fallback
            .contours
            .is_empty());

        let mut import = font.begin_import().unwrap();
        assert!(import
            .directory()
            .iter()
            .any(|glyph| glyph.name.as_str() == "layerOnly"));
        let glyphs = import
            .next_batch(crate::ImportBatchLimit::new(1_000, 10_000))
            .unwrap();
        let glyph = glyphs
            .iter()
            .find(|glyph| glyph.name() == "layerOnly")
            .expect("authored import should include the layer-only glyph");
        assert!(glyph
            .layers()
            .values()
            .any(|layer| !layer.contours().is_empty()));
    }

    fn add_layer_only_glyph(ufo: &Path, layer: &str, source_file: &str) {
        let layer = ufo.join(layer);
        let mut source = fs::read_to_string(layer.join(source_file)).unwrap();
        let name_start = source.find("<glyph name=\"").unwrap() + "<glyph name=\"".len();
        let name_end = name_start + source[name_start..].find('"').unwrap();
        source.replace_range(name_start..name_end, "layerOnly");
        fs::write(layer.join("layerOnly.glif"), source).unwrap();

        let contents_path = layer.join("contents.plist");
        let mut contents =
            plist::from_file::<_, BTreeMap<String, PathBuf>>(&contents_path).unwrap();
        contents.insert("layerOnly".into(), "layerOnly.glif".into());
        plist::to_file_xml(contents_path, &contents).unwrap();
    }

    fn copy_directory(source: &Path, target: &Path) {
        fs::create_dir_all(target).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let destination = target.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_directory(&entry.path(), &destination);
            } else {
                fs::copy(entry.path(), destination).unwrap();
            }
        }
    }
}
