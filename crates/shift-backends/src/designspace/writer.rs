use super::axis_labels;
use super::error::{DesignspaceError, DesignspaceResult};
use crate::atomic::write_file_atomic;
use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::traits::{FontView, FontWriter};
use crate::ufo::UfoWriter;
use norad::designspace::{
    Axis as DsAxis, AxisMapping as DsAxisMapping, AxisMappingEntry as DsAxisMappingEntry,
    AxisMappings as DsAxisMappings, DesignSpaceDocument, Dimension, Source as DsSource,
};
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, Event};
use quick_xml::Writer;
use serde::Serialize;
use shift_font::{
    Axis, AxisKind, AxisMapping, BinaryData, FeatureData, Font, FontMetadata, FontMetrics, Glyph,
    Guideline, KerningData, LibData, Location, Source, SourceId,
};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub struct DesignspaceWriter;

/// One UFO file of the designspace project: the sources whose data lives in
/// that file and, if any, the source that owns the file's default layer.
struct UfoFileGroup {
    filename: String,
    sources: Vec<Source>,
    file_default: Option<SourceId>,
}

/// A [`FontView`] scoped to one UFO file of a multi-UFO designspace: only
/// the sources assigned to that file are visible, and the file's own
/// default-layer source stands in as the view's default source.
struct UfoFileView<'a> {
    font: &'a Font,
    metadata: FontMetadata,
    sources: &'a [Source],
    default_source_id: Option<SourceId>,
}

impl<'a> UfoFileView<'a> {
    fn new(font: &'a Font, group: &'a UfoFileGroup) -> Self {
        let mut metadata = font.metadata().clone();

        // Companion UFOs conventionally carry their own master's style name.
        if group.file_default != font.default_source_id() {
            if let Some(source) = group
                .sources
                .iter()
                .find(|source| Some(source.id()) == group.file_default)
            {
                metadata.style_name = Some(source.name().to_string());
            }
        }

        Self {
            font,
            metadata,
            sources: &group.sources,
            default_source_id: group.file_default.clone(),
        }
    }
}

impl FontView for UfoFileView<'_> {
    fn metadata(&self) -> &FontMetadata {
        &self.metadata
    }

    fn metrics(&self) -> &FontMetrics {
        self.font.metrics()
    }

    fn axes(&self) -> &[Axis] {
        self.font.axes()
    }

    fn sources(&self) -> &[Source] {
        self.sources
    }

    fn default_source_id(&self) -> Option<SourceId> {
        self.default_source_id.clone()
    }

    fn glyphs(&self) -> Vec<&Glyph> {
        self.font.glyphs().collect()
    }

    fn glyph(&self, name: &str) -> Option<&Glyph> {
        self.font.glyph_by_name(name)
    }

    fn kerning(&self) -> &KerningData {
        self.font.kerning()
    }

    fn features(&self) -> &FeatureData {
        self.font.features()
    }

    fn guidelines(&self) -> &[Guideline] {
        self.font.guidelines()
    }

    fn lib(&self) -> &LibData {
        self.font.lib()
    }

    fn fontinfo_remainder(&self) -> &LibData {
        self.font.fontinfo_remainder()
    }

    fn data_files(&self) -> &BinaryData {
        self.font.data_files()
    }

    fn images(&self) -> &BinaryData {
        self.font.images()
    }
}

impl DesignspaceWriter {
    pub fn new() -> Self {
        Self
    }

    fn designspace_stem(path: &Path) -> DesignspaceResult<&str> {
        path.file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(|| DesignspaceError::InvalidDesignspacePath {
                path: path.to_path_buf(),
            })
    }

    /// Assigns every source to the UFO file it will be written into.
    ///
    /// Sources keep the filename they were read from. Layer-only sources
    /// without a filename ride along in the default source's file. Masters
    /// without a filename (created inside Shift) get a deterministic,
    /// collision-safe filename derived from the designspace stem and their
    /// style name.
    fn group_sources(font: &Font, stem: &str) -> Vec<UfoFileGroup> {
        let font_default = font.default_source_id();
        let default_filename = font
            .default_source()
            .and_then(|source| source.filename())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{stem}.ufo"));

        let mut used: HashSet<String> = font
            .sources()
            .iter()
            .filter_map(|source| source.filename().map(str::to_string))
            .collect();
        used.insert(default_filename.clone());

        let mut groups = vec![UfoFileGroup {
            filename: default_filename.clone(),
            sources: Vec::new(),
            file_default: None,
        }];

        for source in font.sources() {
            let filename = match source.filename() {
                Some(filename) => filename.to_string(),
                None if Some(source.id()) == font_default || !source.is_master() => {
                    default_filename.clone()
                }
                None => Self::generated_filename(stem, source.name(), &mut used),
            };

            match groups.iter_mut().find(|group| group.filename == filename) {
                Some(group) => group.sources.push(source.clone()),
                None => groups.push(UfoFileGroup {
                    filename,
                    sources: vec![source.clone()],
                    file_default: None,
                }),
            }
        }

        for group in &mut groups {
            group.file_default = Self::file_default(&group.sources, &font_default);
        }

        groups
    }

    fn generated_filename(stem: &str, source_name: &str, used: &mut HashSet<String>) -> String {
        let sanitized: String = source_name
            .chars()
            .map(|c| if matches!(c, '/' | '\\') { '-' } else { c })
            .collect();
        let sanitized = sanitized.trim();
        let base = if sanitized.is_empty() {
            format!("{stem}-Master")
        } else {
            format!("{stem}-{sanitized}")
        };

        let mut candidate = format!("{base}.ufo");
        let mut counter = 2;
        while !used.insert(candidate.clone()) {
            candidate = format!("{base}-{counter}.ufo");
            counter += 1;
        }

        candidate
    }

    /// The source that owns the file's default layer: the font default if it
    /// lives in this file, otherwise the file's master without a layer
    /// binding. `None` means the file has only named layers and its default
    /// layer is written empty.
    fn file_default(sources: &[Source], font_default: &Option<SourceId>) -> Option<SourceId> {
        if let Some(id) = font_default {
            if sources.iter().any(|source| source.id() == *id) {
                return Some(id.clone());
            }
        }

        sources
            .iter()
            .find(|source| source.is_master() && source.layer_name().is_none())
            .map(Source::id)
    }

    /// The `layer` attribute for a master's `<source>` entry: absent for the
    /// file's default layer, otherwise the UFO layer holding its data.
    fn ds_layer_attr<'a>(source: &'a Source, file_default: &Option<SourceId>) -> Option<&'a str> {
        if Some(source.id()) == *file_default {
            None
        } else {
            Some(source.layer_name().unwrap_or_else(|| source.name()))
        }
    }

    fn axis(axis: &Axis, mappings: &[AxisMapping]) -> DsAxis {
        let map = mappings
            .iter()
            .find(|mapping| {
                mapping.is_independent() && mapping.inputs().first() == Some(&axis.id())
            })
            .map(|mapping| {
                mapping
                    .points()
                    .iter()
                    .filter_map(|point| {
                        Some(DsAxisMapping {
                            input: point.input.get(&axis.id())? as f32,
                            output: point.output.get(&axis.id())? as f32,
                        })
                    })
                    .collect()
            });

        let (minimum, maximum, values) = match axis.kind() {
            AxisKind::Continuous {
                minimum, maximum, ..
            } => (Some(*minimum as f32), Some(*maximum as f32), None),
            AxisKind::Discrete { values, .. } => (
                None,
                None,
                Some(values.iter().map(|value| *value as f32).collect()),
            ),
        };

        DsAxis {
            name: axis.name().to_string(),
            tag: axis.tag().to_string(),
            minimum,
            default: axis.default() as f32,
            maximum,
            values,
            map,
            hidden: axis.is_hidden(),
            ..Default::default()
        }
    }

    fn mapping_location(location: &Location, axes: &[Axis]) -> Vec<Dimension> {
        location
            .iter()
            .filter_map(|(axis_id, value)| {
                let axis = axes.iter().find(|axis| axis.id() == *axis_id)?;
                Some(Dimension {
                    name: axis.name().to_string(),
                    xvalue: Some(*value as f32),
                    ..Default::default()
                })
            })
            .collect()
    }

    fn cross_axis_mappings(mappings: &[AxisMapping], axes: &[Axis]) -> Option<DsAxisMappings> {
        let mapping = mappings.iter().find(|mapping| !mapping.is_independent())?;
        let mappings = mapping
            .points()
            .iter()
            .map(|point| DsAxisMappingEntry {
                description: point.description.clone(),
                input: Self::mapping_location(&point.input, axes),
                output: Self::mapping_location(&point.output, axes),
            })
            .collect::<Vec<_>>();

        Some(DsAxisMappings {
            description: Some(
                mapping
                    .description()
                    .unwrap_or_else(|| mapping.name())
                    .to_string(),
            ),
            mappings,
        })
    }

    fn location(location: &Location, axes: &[Axis]) -> Vec<Dimension> {
        axes.iter()
            .map(|axis| Dimension {
                name: axis.name().to_string(),
                xvalue: Some(location.get(&axis.id()).unwrap_or(axis.default()) as f32),
                ..Default::default()
            })
            .collect()
    }

    fn source(
        source: &Source,
        font: &Font,
        filename: &str,
        layer: Option<&str>,
        axes: &[Axis],
    ) -> DsSource {
        DsSource {
            familyname: font.metadata().family_name.clone(),
            stylename: Some(source.name().to_string()),
            name: Some(source.name().to_string()),
            filename: filename.to_string(),
            layer: layer.map(str::to_string),
            location: Self::location(source.location(), axes),
        }
    }

    fn write_axisless_source(
        writer: &mut Writer<Vec<u8>>,
        font: &Font,
        filename: &str,
        stylename: &str,
        layer: Option<&str>,
    ) -> DesignspaceResult<()> {
        let mut event = BytesStart::new("source");
        event.push_attribute(("filename", filename));

        if let Some(familyname) = font.metadata().family_name.as_deref() {
            event.push_attribute(("familyname", familyname));
        }

        event.push_attribute(("stylename", stylename));
        event.push_attribute(("name", stylename));

        if let Some(layer) = layer {
            event.push_attribute(("layer", layer));
        }

        writer.write_event(Event::Empty(event)).map_err(|error| {
            DesignspaceError::ParseAxislessXml {
                details: error.to_string(),
            }
        })
    }

    fn save_axisless_designspace(
        font: &Font,
        path: &Path,
        groups: &[UfoFileGroup],
    ) -> DesignspaceResult<()> {
        let mut writer = Writer::new_with_indent(Vec::new(), b' ', 2);
        writer
            .write_event(Event::Decl(BytesDecl::new("1.0", Some("UTF-8"), None)))
            .map_err(|error| DesignspaceError::ParseAxislessXml {
                details: error.to_string(),
            })?;

        let mut designspace = BytesStart::new("designspace");
        designspace.push_attribute(("format", "5.0"));
        writer
            .write_event(Event::Start(designspace))
            .map_err(|error| DesignspaceError::ParseAxislessXml {
                details: error.to_string(),
            })?;
        writer
            .write_event(Event::Start(BytesStart::new("sources")))
            .map_err(|error| DesignspaceError::ParseAxislessXml {
                details: error.to_string(),
            })?;

        let mut wrote_source = false;
        for group in groups {
            for source in group.sources.iter().filter(|source| source.is_master()) {
                Self::write_axisless_source(
                    &mut writer,
                    font,
                    &group.filename,
                    source.name(),
                    Self::ds_layer_attr(source, &group.file_default),
                )?;
                wrote_source = true;
            }
        }

        if !wrote_source {
            Self::write_axisless_source(&mut writer, font, &groups[0].filename, "Regular", None)?;
        }

        writer
            .write_event(Event::End(BytesEnd::new("sources")))
            .map_err(|error| DesignspaceError::ParseAxislessXml {
                details: error.to_string(),
            })?;
        writer
            .write_event(Event::End(BytesEnd::new("designspace")))
            .map_err(|error| DesignspaceError::ParseAxislessXml {
                details: error.to_string(),
            })?;

        write_file_atomic(path, &writer.into_inner()).map_err(|source| {
            DesignspaceError::WriteFile {
                path: path.to_path_buf(),
                source,
            }
        })
    }

    /// Serializes exactly like norad's `DesignSpaceDocument::save`, but
    /// routed through a temp-file + fsync + rename so a failed save never
    /// truncates the existing designspace.
    fn save_document_atomic(
        document: &DesignSpaceDocument,
        axes: &[Axis],
        path: &Path,
    ) -> DesignspaceResult<()> {
        let mut xml = String::from("<?xml version='1.0' encoding='UTF-8'?>\n");
        let mut serializer = quick_xml::se::Serializer::new(&mut xml);
        serializer.indent(' ', 2);
        document
            .serialize(serializer)
            .map_err(|error| DesignspaceError::SaveDesignspace {
                path: path.to_path_buf(),
                details: error.to_string(),
            })?;
        xml.push('\n');
        let xml = axis_labels::insert(&xml, axes)?;

        write_file_atomic(path, &xml).map_err(|source| DesignspaceError::WriteFile {
            path: path.to_path_buf(),
            source,
        })
    }

    fn path_to_str(path: &Path) -> DesignspaceResult<&str> {
        path.to_str()
            .ok_or_else(|| DesignspaceError::InvalidPathUtf8 {
                path: path.to_path_buf(),
            })
    }

    fn save_designspace(&self, font: &Font, path: &Path) -> DesignspaceResult<()> {
        let parent = path
            .parent()
            .ok_or_else(|| DesignspaceError::MissingParent {
                path: path.to_path_buf(),
            })?;
        fs::create_dir_all(parent).map_err(|source| DesignspaceError::CreateDir {
            path: parent.to_path_buf(),
            source,
        })?;

        let stem = Self::designspace_stem(path)?;
        let groups = Self::group_sources(font, stem);

        // Data before pointer: every UFO is written (each atomically) before
        // the designspace XML that references them. If the save fails
        // partway, the old XML is untouched and still names the same UFO
        // files, each of which is either its previous revision or a
        // completed new one — the project on disk never points at
        // half-written data. UFOs newly created by an aborted save are
        // unreferenced and harmless.
        for group in &groups {
            let ufo_path = parent.join(&group.filename);
            let view = UfoFileView::new(font, group);
            UfoWriter::new()
                .save_view(&view, Self::path_to_str(&ufo_path)?)
                .map_err(|source| DesignspaceError::SaveUfo {
                    path: ufo_path.clone(),
                    details: source.to_string(),
                })?;
        }

        let axes = font.axes();
        if axes.is_empty() {
            return Self::save_axisless_designspace(font, path, &groups);
        }

        let mut sources = Vec::new();
        for group in &groups {
            for source in group.sources.iter().filter(|source| source.is_master()) {
                sources.push(Self::source(
                    source,
                    font,
                    &group.filename,
                    Self::ds_layer_attr(source, &group.file_default),
                    axes,
                ));
            }
        }

        if sources.is_empty() {
            sources.push(DsSource {
                familyname: font.metadata().family_name.clone(),
                stylename: Some("Regular".to_string()),
                name: Some("Regular".to_string()),
                filename: groups[0].filename.clone(),
                location: Self::location(&Location::new(), axes),
                ..Default::default()
            });
        }

        let axis_mappings = Self::cross_axis_mappings(font.axis_mappings(), axes);
        let format = if axis_mappings.is_some() { 5.2 } else { 5.0 };
        let document = DesignSpaceDocument {
            format,
            axes: axes
                .iter()
                .map(|axis| Self::axis(axis, font.axis_mappings()))
                .collect(),
            axis_mappings,
            sources,
            ..Default::default()
        };

        Self::save_document_atomic(&document, axes, path)
    }
}

impl Default for DesignspaceWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl FontWriter for DesignspaceWriter {
    fn save(&self, font: &Font, path: &str) -> FormatBackendResult<()> {
        self.save_designspace(font, Path::new(path))
            .map_err(FormatBackendError::from)
    }
}
