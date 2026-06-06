use super::error::{DesignspaceError, DesignspaceResult};
use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::traits::FontWriter;
use crate::ufo::UfoWriter;
use norad::designspace::{Axis as DsAxis, DesignSpaceDocument, Dimension, Source as DsSource};
use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, Event};
use quick_xml::Writer;
use shift_font::{Axis, Font, Location, Source};
use std::fs;
use std::path::Path;

pub struct DesignspaceWriter;

impl DesignspaceWriter {
    pub fn new() -> Self {
        Self
    }

    fn companion_ufo_filename(path: &Path) -> DesignspaceResult<String> {
        let stem = path
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(|| DesignspaceError::InvalidDesignspacePath {
                path: path.to_path_buf(),
            })?;

        Ok(format!("{stem}.ufo"))
    }

    fn axis(axis: &Axis) -> DsAxis {
        DsAxis {
            name: axis.name().to_string(),
            tag: axis.tag().to_string(),
            minimum: Some(axis.minimum() as f32),
            default: axis.default() as f32,
            maximum: Some(axis.maximum() as f32),
            hidden: axis.is_hidden(),
            ..Default::default()
        }
    }

    fn location(location: &Location, axes: &[Axis]) -> Vec<Dimension> {
        axes.iter()
            .map(|axis| Dimension {
                name: axis.name().to_string(),
                xvalue: Some(location.get(axis.tag()).unwrap_or(axis.default()) as f32),
                ..Default::default()
            })
            .collect()
    }

    fn source(source: &Source, font: &Font, filename: &str, axes: &[Axis]) -> DsSource {
        let layer = if Some(source.id()) == font.default_source_id() {
            None
        } else {
            Some(source.name().to_string())
        };

        DsSource {
            familyname: font.metadata().family_name.clone(),
            stylename: Some(source.name().to_string()),
            name: Some(source.name().to_string()),
            filename: filename.to_string(),
            layer,
            location: Self::location(source.location(), axes),
        }
    }

    fn source_layer(source: &Source, font: &Font) -> Option<String> {
        if Some(source.id()) == font.default_source_id() {
            None
        } else {
            Some(source.name().to_string())
        }
    }

    fn write_axisless_source(
        writer: &mut Writer<Vec<u8>>,
        font: &Font,
        filename: &str,
        source: Option<&Source>,
    ) -> DesignspaceResult<()> {
        let mut event = BytesStart::new("source");
        event.push_attribute(("filename", filename));

        if let Some(familyname) = font.metadata().family_name.as_deref() {
            event.push_attribute(("familyname", familyname));
        }

        let stylename = source
            .map(|source| source.name().to_string())
            .or_else(|| Some("Regular".to_string()));
        if let Some(stylename) = stylename.as_deref() {
            event.push_attribute(("stylename", stylename));
            event.push_attribute(("name", stylename));
        }

        let layer = source.and_then(|source| Self::source_layer(source, font));
        if let Some(layer) = layer.as_deref() {
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
        ufo_filename: &str,
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

        let sources = font.sources();
        if sources.is_empty() {
            Self::write_axisless_source(&mut writer, font, ufo_filename, None)?;
        } else {
            for source in sources {
                Self::write_axisless_source(&mut writer, font, ufo_filename, Some(source))?;
            }
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

        fs::write(path, writer.into_inner()).map_err(|source| DesignspaceError::WriteFile {
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

        let ufo_filename = Self::companion_ufo_filename(path)?;
        let ufo_path = parent.join(&ufo_filename);
        UfoWriter::new()
            .save(font, Self::path_to_str(&ufo_path)?)
            .map_err(|source| DesignspaceError::SaveUfo {
                path: ufo_path.clone(),
                details: source.to_string(),
            })?;

        let axes = font.axes();
        if axes.is_empty() {
            return Self::save_axisless_designspace(font, path, &ufo_filename);
        }

        let mut document = DesignSpaceDocument {
            format: 5.0,
            axes: axes.iter().map(Self::axis).collect(),
            sources: font
                .sources()
                .iter()
                .map(|source| Self::source(source, font, &ufo_filename, axes))
                .collect(),
            ..Default::default()
        };

        if document.sources.is_empty() {
            document.sources.push(DsSource {
                familyname: font.metadata().family_name.clone(),
                stylename: Some("Regular".to_string()),
                name: Some("Regular".to_string()),
                filename: ufo_filename,
                location: Self::location(&Location::new(), axes),
                ..Default::default()
            });
        }

        document
            .save(path)
            .map_err(|source| DesignspaceError::SaveDesignspace {
                path: path.to_path_buf(),
                details: source.to_string(),
            })
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
