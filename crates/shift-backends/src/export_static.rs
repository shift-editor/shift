//! Static instance export: one TrueType binary per named instance, each the
//! font evaluated at the instance's location and compiled without axes.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use shift_font::{CoreError, Font, NamedInstance};

use crate::export::{ExportError, ExportFormat, FontExportResult, FontExporter, postscript_safe};

/// One binary a static export writes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StaticInstanceFile {
    /// The named instance the file holds; for a font without axes, its style name.
    pub style_name: String,
    /// The file's name inside the export directory, such as `Solenoid-Regular.ttf`.
    pub file_name: String,
}

impl FontExporter {
    /// Names the files [`Self::export_static_instances`] writes for `font`,
    /// in named-instance order.
    ///
    /// Each file is named after the instance's PostScript name, or else
    /// `<family>-<instance>` with the characters PostScript names leave out
    /// removed; a name taken by an earlier file gains `-2`, `-3`, and so on. A
    /// font without axes writes one file for its own style.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError::NoNamedInstances`] for a variable font with no
    /// named instances.
    pub fn static_instance_files(font: &Font) -> Result<Vec<StaticInstanceFile>, ExportError> {
        let family = font.metadata().family_name.as_deref().unwrap_or("Untitled");
        let mut taken = HashSet::new();
        let mut name = |style_name: &str, postscript_name: Option<&str>| {
            let stem = postscript_name.map_or_else(
                || postscript_safe(&format!("{family}-{style_name}")),
                str::to_string,
            );
            let mut file_name = format!("{stem}.{}", ExportFormat::Ttf.extension());
            let mut counter = 2;
            while !taken.insert(file_name.clone()) {
                file_name = format!("{stem}-{counter}.{}", ExportFormat::Ttf.extension());
                counter += 1;
            }
            StaticInstanceFile {
                style_name: style_name.to_string(),
                file_name,
            }
        };

        if !font.is_variable() {
            let style = font.metadata().style_name.as_deref().unwrap_or("Regular");
            return Ok(vec![name(style, None)]);
        }
        if font.named_instances().is_empty() {
            return Err(ExportError::NoNamedInstances);
        }
        Ok(font
            .named_instances()
            .iter()
            .map(|instance| name(instance.name(), instance.postscript_name()))
            .collect())
    }

    /// Compiles every named instance of `font` to a static TrueType binary in
    /// `directory`, named as [`Self::static_instance_files`] lists, and
    /// returns them in that order. A font without axes compiles once, as it
    /// is.
    ///
    /// Each binary is [`Font::static_instance`] compiled through fontc, so its
    /// outlines, metrics and kerning are the variable font's at that
    /// location. Each file replaces its destination atomically; files of
    /// instances compiled before a failure stay written.
    ///
    /// # Errors
    ///
    /// Returns [`ExportError::NoNamedInstances`] for a variable font with no
    /// named instances, [`ExportError::CreateDirectory`] when `directory`
    /// cannot be created, [`ExportError::StaticInstance`] when an instance
    /// cannot be evaluated, and the compile and write errors of TrueType
    /// export.
    pub fn export_static_instances(
        &self,
        font: &Font,
        directory: &Path,
    ) -> Result<Vec<FontExportResult>, ExportError> {
        let files = Self::static_instance_files(font)?;
        crate::export::create_directory(directory)?;

        if !font.is_variable() {
            let file = files.first().ok_or(ExportError::NoNamedInstances)?;
            return Ok(vec![self.write_static(font, directory, file)?]);
        }

        font.named_instances()
            .iter()
            .zip(&files)
            .map(|(instance, file)| {
                let static_font = static_font(font, instance)?;
                self.write_static(&static_font, directory, file)
            })
            .collect()
    }

    fn write_static(
        &self,
        font: &Font,
        directory: &Path,
        file: &StaticInstanceFile,
    ) -> Result<FontExportResult, ExportError> {
        let path: PathBuf = directory.join(&file.file_name);
        self.export_ttf(font, &path)?;
        Ok(FontExportResult {
            files: vec![path.clone()],
            path,
            format: ExportFormat::Ttf,
        })
    }
}

fn static_font(font: &Font, instance: &NamedInstance) -> Result<Font, ExportError> {
    font.static_instance(instance)
        .map_err(|source: CoreError| ExportError::StaticInstance {
            instance: instance.name().to_string(),
            source,
        })
}
