use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use norad::designspace::DesignSpaceDocument;

use crate::font_source::interpolation::InterpolationAxis;
use crate::font_source::projection::{build_directory, resolve_projection_closure};
use crate::font_source::{
    malformed, AxisIndex, DirectoryAxisMapping, DirectorySource, FontDirectory, FontImporter,
    FontReadError, FontSource, GlyphIndex, ProjectedGlyph, SourceIndex, VariationAxis,
};
use crate::formats::ufo::glif::{
    load_norad_header, project_glif_glyph, retained_layer, RetainedUfoLayer,
};
use crate::{BackendError, BackendResult, FontFormat, FontImport};

use super::{
    derive_axis_range, find_default_source_index, map_axis_value, source_axis_design_value,
    source_name, stream_retained, variation_axis_kind,
};

/// Retained source locations and UFO glyph bytes for one Designspace.
pub struct DesignspaceFont {
    path: PathBuf,
    directory: FontDirectory,
    glyphs_by_name: HashMap<String, GlyphIndex>,
    sources: Vec<(Vec<f64>, Box<[RetainedUfoLayer]>)>,
    default_source: usize,
    interpolation_axes: Vec<InterpolationAxis>,
    import_paths: Arc<[BTreeMap<String, PathBuf>]>,
}

impl DesignspaceFont {
    pub fn open(path: &Path) -> Result<Self, FontReadError> {
        if !matches!(
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("designspace")
        ) {
            return Err(FontReadError::UnsupportedFormat {
                path: path.to_path_buf(),
            });
        }

        let document = DesignSpaceDocument::load(path)
            .map_err(|error| malformed(path, format!("failed to parse Designspace: {error}")))?;
        if document.sources.is_empty() {
            return Err(malformed(path, "Designspace has no sources".into()));
        }
        let default_source = find_default_source_index(&document).ok_or_else(|| {
            malformed(
                path,
                "Designspace has no source at the mapped default location".into(),
            )
        })?;
        let directory_path = path
            .parent()
            .ok_or_else(|| malformed(path, "Designspace path has no parent directory".into()))?;
        let default_descriptor = &document.sources[default_source];
        let default_ufo = directory_path.join(&default_descriptor.filename);
        let header = load_norad_header(&default_ufo)?;
        let mut source_paths = Vec::with_capacity(document.sources.len());
        let mut names = Vec::new();
        let mut seen_names = HashSet::new();
        for descriptor in &document.sources {
            let ufo = directory_path.join(&descriptor.filename);
            let paths = crate::formats::ufo::read_glyph_paths(&ufo, descriptor.layer.as_deref())
                .map_err(|error| malformed(path, error.to_string()))?;
            for name in paths.keys() {
                if seen_names.insert(name.clone()) {
                    names.push(name.clone());
                }
            }
            source_paths.push(paths);
        }
        names.sort();

        let axes = document
            .axes
            .iter()
            .enumerate()
            .map(|(index, axis)| VariationAxis {
                index: AxisIndex::new(index as u32),
                tag: axis.tag.clone(),
                name: axis.name.clone(),
                hidden: axis.hidden,
                kind: variation_axis_kind(axis),
            })
            .collect::<Vec<_>>();
        let interpolation_axes = document
            .axes
            .iter()
            .map(|axis| {
                let (user_minimum, user_maximum) = derive_axis_range(axis);
                let default = map_axis_value(axis, f64::from(axis.default));
                let mut design_values = vec![
                    map_axis_value(axis, user_minimum),
                    default,
                    map_axis_value(axis, user_maximum),
                ];
                if let Some(mapping) = &axis.map {
                    design_values.extend(mapping.iter().map(|point| f64::from(point.output)));
                }
                InterpolationAxis {
                    tag: axis.tag.clone(),
                    minimum: design_values.iter().copied().fold(default, f64::min),
                    default,
                    maximum: design_values.iter().copied().fold(default, f64::max),
                }
            })
            .collect::<Vec<_>>();
        let family_name = default_descriptor
            .familyname
            .clone()
            .or_else(|| header.font_info.family_name.clone());
        let (mut directory, glyphs_by_name) = build_directory(
            FontFormat::Designspace,
            family_name,
            header.font_info.style_name.clone(),
            header
                .font_info
                .units_per_em
                .map(|value| *value)
                .unwrap_or(1_000.0),
            names
                .into_iter()
                .map(|name| (name, Vec::new().into_boxed_slice()))
                .collect(),
            axes,
        )?;
        let source_locations = document
            .sources
            .iter()
            .map(|descriptor| {
                document
                    .axes
                    .iter()
                    .map(|axis| source_axis_design_value(&descriptor.location, axis))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let sources = source_paths
            .iter()
            .cloned()
            .zip(&source_locations)
            .map(|(paths, location)| {
                retained_layer(&directory, paths)
                    .map(|layer| (location.clone(), vec![layer].into_boxed_slice()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let import_paths = Arc::from(
            sources
                .iter()
                .map(|(_, layers)| layers[0].paths.clone())
                .collect::<Vec<_>>(),
        );
        let mut source_names = HashSet::new();
        let directory_sources = document
            .sources
            .iter()
            .zip(source_locations)
            .enumerate()
            .map(|(index, (descriptor, location))| {
                let name = source_name(descriptor, None, &source_names, index);
                source_names.insert(name.clone());
                DirectorySource {
                    index: SourceIndex::new(index as u32),
                    name,
                    location: location.into_boxed_slice(),
                    filename: Some(descriptor.filename.clone()),
                }
            })
            .collect();
        directory.set_sources(directory_sources, SourceIndex::new(default_source as u32))?;
        directory.set_axis_mappings(
            document
                .axes
                .iter()
                .enumerate()
                .filter_map(|(index, axis)| {
                    let points = axis.map.as_ref()?;
                    Some(DirectoryAxisMapping {
                        axis: AxisIndex::new(index as u32),
                        points: points
                            .iter()
                            .map(|point| (f64::from(point.input), f64::from(point.output)))
                            .collect::<Vec<_>>()
                            .into_boxed_slice(),
                    })
                })
                .collect(),
        );

        Ok(Self {
            path: path.to_path_buf(),
            directory,
            glyphs_by_name,
            sources,
            default_source,
            interpolation_axes,
            import_paths,
        })
    }
}

impl FontSource for DesignspaceFont {
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
                    self.default_source,
                    &self.interpolation_axes,
                    glyph,
                )
            },
        )
    }
}

impl FontImporter for DesignspaceFont {
    fn begin_import(&self) -> BackendResult<FontImport> {
        let (header, stream) =
            stream_retained(&self.path, self.import_paths.clone()).map_err(|source| {
                BackendError::load(FontFormat::Designspace, self.path.clone(), source)
            })?;
        Ok(FontImport::new(
            header,
            Box::new(stream),
            FontFormat::Designspace,
            self.path.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

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
    fn designspace_nondefault_glyph_matches_authored_import() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("LayerOnlyDesignspace");
        copy_directory(&fixture("mutatorsans-variable"), &copied);
        add_layer_only_glyph(
            &copied.join("MutatorSansBoldCondensed.ufo"),
            "glyphs",
            "A_.glif",
        );

        let font = DesignspaceFont::open(&copied.join("MutatorSans.designspace")).unwrap();
        assert_projection_and_import_contain_layer_only(&font);
    }

    #[test]
    fn designspace_projection_retains_variation_after_source_removal() {
        let temporary = tempfile::tempdir().unwrap();
        let copied = temporary.path().join("Removed");
        copy_directory(&fixture("mutatorsans-variable"), &copied);
        let font = DesignspaceFont::open(&copied.join("MutatorSans.designspace")).unwrap();
        let glyph = font
            .directory()
            .glyphs
            .iter()
            .find(|glyph| glyph.name == "S")
            .expect("fixture should contain S");
        let glyph = glyph.index;
        fs::remove_dir_all(&copied).unwrap();
        let projection = font.glyph(glyph).unwrap().root;
        let variation = projection
            .variation
            .expect("variable designspace glyph should retain deltas");

        assert!(variation
            .deltas
            .iter()
            .flat_map(|delta| delta.values.iter())
            .any(|value| *value != 0.0));
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
