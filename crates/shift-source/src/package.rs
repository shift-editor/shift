use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{self, Read, Seek, Write},
    path::{Path, PathBuf},
    str::FromStr,
    string::FromUtf8Error,
};

use serde::{Deserialize, Serialize};
use shift_font::{
    Anchor, Axis, Component, ComponentId, Contour, DecomposedTransform, FeatureData, Font,
    FontMetadata, FontMetrics, Glyph, GlyphLayer, GlyphName, Guideline, KerningData, KerningPair,
    KerningSide, LibData, LibValue, Location, Point, PointType, Source, SourceId,
};
use zip::{CompressionMethod, ZipArchive, ZipWriter, result::ZipError, write::SimpleFileOptions};

pub const MANIFEST_FILE: &str = "manifest.json";
pub const FONT_FILE: &str = "font.json";
pub const AXES_FILE: &str = "axes.json";
pub const SOURCES_FILE: &str = "sources.json";
pub const FEATURES_FILE: &str = "features.fea";
pub const KERNING_FILE: &str = "kerning.json";
pub const GLYPHS_DIR: &str = "glyphs";
pub const MODULES_DIR: &str = "modules";
pub const LIB_MODULE_FILE: &str = "modules/shift.libData.json";

const FORMAT_ID: &str = "shift-source";
const SCHEMA_VERSION: u32 = 1;
const KERNING_SCHEMA_VERSION: u32 = 1;
const LIB_MODULE_OWNER: &str = "shift";
const LIB_MODULE_NAME: &str = "libData";
const LIB_MODULE_SCHEMA_VERSION: u32 = 1;

pub type PackageTree = Vec<(String, Vec<u8>)>;

#[derive(Debug, thiserror::Error)]
pub enum SourcePackageError {
    #[error("source package path must use the .shift extension: {0}")]
    InvalidExtension(PathBuf),

    #[error("source package does not exist: {0}")]
    MissingPackage(PathBuf),

    #[error("source package already exists: {0}")]
    AlreadyExists(PathBuf),

    #[error("source package is not a file: {0}")]
    NotAFile(PathBuf),

    #[error("source package missing entry: {0}")]
    MissingEntry(String),

    #[error("source package manifest must be the first zip entry")]
    ManifestNotFirst,

    #[error("source package manifest must be stored uncompressed")]
    ManifestCompressed,

    #[error("unsupported source package format: {0}")]
    UnsupportedFormat(String),

    #[error("unsupported source package schema version: {0}")]
    UnsupportedSchemaVersion(u32),

    #[error("glyph file path {path} does not match glyph id {id}")]
    MismatchedGlyphFileId { path: String, id: String },

    #[error("invalid unicode scalar value: {0}")]
    InvalidUnicode(String),

    #[error("invalid {kind} id {value}: {message}")]
    InvalidId {
        kind: &'static str,
        value: String,
        message: String,
    },

    #[error("invalid glyph name {0:?}")]
    InvalidGlyphName(String),

    #[error("unresolved glyph name {name:?} in {field}")]
    UnresolvedGlyphName { field: &'static str, name: String },

    #[error("dangling {field} reference to {id}")]
    DanglingReference { field: &'static str, id: String },

    #[error("unexpected source package entry: {0}")]
    UnexpectedEntry(String),

    #[error("invalid source package module {path}: {message}")]
    InvalidModule { path: String, message: String },

    #[error("source package JSON error in {path}")]
    Json {
        path: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("source package text error in {path}")]
    Text {
        path: String,
        #[source]
        source: FromUtf8Error,
    },

    #[error("source package zip error")]
    Zip(#[from] ZipError),

    #[error("source package file-system error")]
    Io(#[from] io::Error),

    #[error("font model error")]
    Font(#[from] shift_font::CoreError),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShiftSourcePackage {
    path: PathBuf,
}

impl ShiftSourcePackage {
    pub fn is_package_path(path: impl AsRef<Path>) -> bool {
        path.as_ref()
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("shift"))
    }

    pub fn create_empty(path: impl AsRef<Path>) -> Result<Self, SourcePackageError> {
        let path = path.as_ref();
        validate_shift_extension(path)?;

        if path.exists() {
            return Err(SourcePackageError::AlreadyExists(path.to_path_buf()));
        }

        Self::save_font(path, &Font::new())
    }

    pub fn save_font(path: impl AsRef<Path>, font: &Font) -> Result<Self, SourcePackageError> {
        let path = path.as_ref();
        validate_shift_extension(path)?;
        write_tree_atomic(path, font_to_tree(font)?)?;
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self, SourcePackageError> {
        let path = path.as_ref();
        validate_shift_extension(path)?;
        validate_package(path)?;
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    pub fn load_font(path: impl AsRef<Path>) -> Result<Font, SourcePackageError> {
        let path = path.as_ref();
        validate_shift_extension(path)?;
        tree_to_font(read_tree(path)?)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestDoc {
    format: String,
    schema_version: u32,
    default_source_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontDoc {
    metadata: MetadataDoc,
    metrics: MetricsDoc,
    #[serde(default)]
    guidelines: Vec<GuidelineDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetadataDoc {
    family_name: Option<String>,
    style_name: Option<String>,
    version_major: Option<i32>,
    version_minor: Option<i32>,
    copyright: Option<String>,
    trademark: Option<String>,
    designer: Option<String>,
    designer_url: Option<String>,
    manufacturer: Option<String>,
    manufacturer_url: Option<String>,
    license: Option<String>,
    license_url: Option<String>,
    description: Option<String>,
    note: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetricsDoc {
    units_per_em: f64,
    ascender: f64,
    descender: f64,
    cap_height: Option<f64>,
    x_height: Option<f64>,
    line_gap: Option<f64>,
    italic_angle: Option<f64>,
    underline_position: Option<f64>,
    underline_thickness: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AxesDoc {
    axes: Vec<AxisDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AxisDoc {
    tag: String,
    name: String,
    minimum: f64,
    default: f64,
    maximum: f64,
    hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourcesDoc {
    sources: Vec<SourceDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceDoc {
    id: String,
    name: String,
    location: BTreeMap<String, f64>,
    filename: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlyphDoc {
    id: String,
    name: String,
    unicodes: Vec<String>,
    layers: BTreeMap<String, LayerDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerDoc {
    id: String,
    advance: f64,
    height: Option<f64>,
    contours: Vec<ContourDoc>,
    components: BTreeMap<String, ComponentDoc>,
    anchors: Vec<AnchorDoc>,
    #[serde(default)]
    guidelines: Vec<GuidelineDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuidelineDoc {
    id: String,
    x: Option<f64>,
    y: Option<f64>,
    angle: Option<f64>,
    name: Option<String>,
    color: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContourDoc {
    id: String,
    closed: bool,
    points: Vec<PointDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PointDoc {
    id: String,
    x: f64,
    y: f64,
    point_type: String,
    smooth: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentDoc {
    base_glyph: String,
    transform: TransformDoc,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransformDoc {
    translate_x: f64,
    translate_y: f64,
    rotation: f64,
    scale_x: f64,
    scale_y: f64,
    skew_x: f64,
    skew_y: f64,
    t_center_x: f64,
    t_center_y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnchorDoc {
    id: String,
    name: Option<String>,
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KerningDoc {
    schema_version: u32,
    pairs: Vec<KerningPairDoc>,
    groups1: BTreeMap<String, Vec<GlyphRefDoc>>,
    groups2: BTreeMap<String, Vec<GlyphRefDoc>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KerningPairDoc {
    first: KerningSideDoc,
    second: KerningSideDoc,
    value: f64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum KerningSideDoc {
    Glyph { glyph_id: String, name: String },
    Group { group_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlyphRefDoc {
    glyph_id: String,
    name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibModuleDoc {
    owner: String,
    module: String,
    schema_version: u32,
    font: BTreeMap<String, LibValueDoc>,
    glyphs: BTreeMap<String, GlyphLibDoc>,
    layers: BTreeMap<String, LayerLibDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlyphLibDoc {
    name: String,
    lib: BTreeMap<String, LibValueDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerLibDoc {
    glyph_id: String,
    glyph_name: String,
    source_id: String,
    lib: BTreeMap<String, LibValueDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
enum LibValueDoc {
    String(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Array(Vec<LibValueDoc>),
    Dict(BTreeMap<String, LibValueDoc>),
    Data(Vec<u8>),
}

pub fn font_to_tree(font: &Font) -> Result<PackageTree, SourcePackageError> {
    let manifest = ManifestDoc {
        format: FORMAT_ID.to_string(),
        schema_version: SCHEMA_VERSION,
        default_source_id: font.default_source_id().map(|id| id.to_string()),
    };

    let font_doc = FontDoc {
        metadata: MetadataDoc::from(font.metadata()),
        metrics: MetricsDoc::from(*font.metrics()),
        guidelines: font.guidelines().iter().map(GuidelineDoc::from).collect(),
    };

    let axes_doc = AxesDoc {
        axes: font.axes().iter().map(AxisDoc::from).collect(),
    };

    let sources_doc = SourcesDoc {
        sources: font.sources().iter().map(SourceDoc::from).collect(),
    };

    let mut tree = vec![
        json_entry(MANIFEST_FILE, &manifest)?,
        json_entry(FONT_FILE, &font_doc)?,
        json_entry(AXES_FILE, &axes_doc)?,
        json_entry(SOURCES_FILE, &sources_doc)?,
    ];

    if let Some(features) = features_entry(font.features()) {
        tree.push(features);
    }

    if kerning_has_data(font.kerning()) {
        tree.push(json_entry(KERNING_FILE, &KerningDoc::from_font(font)?)?);
    }

    if let Some(lib_module_doc) = LibModuleDoc::from_font(font) {
        tree.push(json_entry(LIB_MODULE_FILE, &lib_module_doc)?);
    }

    let mut glyph_entries = font
        .glyphs()
        .map(|glyph| {
            let glyph_doc = GlyphDoc::from(glyph);
            let path = format!("{GLYPHS_DIR}/glyph_{}.json", glyph.id());
            json_entry(&path, &glyph_doc)
        })
        .collect::<Result<Vec<_>, _>>()?;
    glyph_entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    tree.extend(glyph_entries);

    Ok(tree)
}

pub fn tree_to_font(tree: PackageTree) -> Result<Font, SourcePackageError> {
    let mut entries: HashMap<String, Vec<u8>> = tree.into_iter().collect();

    let manifest: ManifestDoc = take_json(&mut entries, MANIFEST_FILE)?;
    validate_manifest(&manifest)?;

    let font_doc: FontDoc = take_json(&mut entries, FONT_FILE)?;
    let axes_doc: AxesDoc = take_json(&mut entries, AXES_FILE)?;
    let sources_doc: SourcesDoc = take_json(&mut entries, SOURCES_FILE)?;
    let features = take_optional_text(&mut entries, FEATURES_FILE)?;
    let kerning_doc: Option<KerningDoc> = take_optional_json(&mut entries, KERNING_FILE)?;
    let mut lib_module_doc: Option<LibModuleDoc> =
        take_optional_json(&mut entries, LIB_MODULE_FILE)?;
    if let Some(module_doc) = &lib_module_doc {
        validate_lib_module(module_doc)?;
    }

    let mut font = Font::empty();
    *font.metadata_mut() = FontMetadata::from(font_doc.metadata);
    *font.metrics_mut() = FontMetrics::from(font_doc.metrics);
    let mut feature_data = FeatureData::new();
    feature_data.set_fea_source(features);
    *font.features_mut() = feature_data;

    for guideline_doc in font_doc.guidelines {
        font.add_guideline(Guideline::try_from(guideline_doc)?);
    }

    if let Some(module_doc) = &mut lib_module_doc {
        *font.lib_mut() = lib_from_doc(std::mem::take(&mut module_doc.font))?;
    }

    for axis_doc in axes_doc.axes {
        font.add_axis(Axis::from(axis_doc));
    }

    for source_doc in sources_doc.sources {
        font.add_source(Source::try_from(source_doc)?);
    }

    if let Some(default_source_id) = manifest.default_source_id {
        font.set_default_source_id(parse_id("source", &default_source_id)?);
    }

    let mut glyph_entries = Vec::new();
    for (path, bytes) in entries {
        if path.starts_with(&format!("{GLYPHS_DIR}/glyph_")) {
            glyph_entries.push((path, bytes));
        } else {
            return Err(SourcePackageError::UnexpectedEntry(path));
        }
    }
    glyph_entries.sort_by(|(left, _), (right, _)| left.cmp(right));

    for (path, bytes) in glyph_entries {
        let glyph_doc: GlyphDoc = from_json(&path, &bytes)?;
        validate_glyph_path_id(&path, &glyph_doc.id)?;
        let mut glyph = Glyph::try_from(glyph_doc)?;
        if let Some(module_doc) = &mut lib_module_doc {
            apply_lib_module_to_glyph(&mut glyph, module_doc)?;
        }
        font.insert_glyph(glyph)?;
    }

    if let Some(module_doc) = lib_module_doc {
        ensure_lib_module_consumed(module_doc)?;
    }

    if let Some(kerning_doc) = kerning_doc {
        *font.kerning_mut() = kerning_from_doc(kerning_doc, &font)?;
    }

    Ok(font)
}

fn validate_package(path: &Path) -> Result<(), SourcePackageError> {
    let mut archive = open_archive(path)?;
    validate_archive_manifest(&mut archive)?;
    Ok(())
}

pub fn read_tree(path: impl AsRef<Path>) -> Result<PackageTree, SourcePackageError> {
    let path = path.as_ref();
    let mut archive = open_archive(path)?;
    validate_archive_manifest(&mut archive)?;

    let mut tree = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        if file.is_dir() {
            continue;
        }

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        tree.push((file.name().to_string(), bytes));
    }

    Ok(tree)
}

pub fn write_tree_atomic(
    path: impl AsRef<Path>,
    tree: PackageTree,
) -> Result<(), SourcePackageError> {
    let path = path.as_ref();
    validate_shift_extension(path)?;
    if path.is_dir() {
        return Err(SourcePackageError::NotAFile(path.to_path_buf()));
    }

    let tmp_path = tmp_path_for(path);
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(&tmp_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    for (entry_path, bytes) in tree {
        zip.start_file(entry_path, options)?;
        zip.write_all(&bytes)?;
    }

    let file = zip.finish()?;
    file.sync_all()?;
    fs::rename(&tmp_path, path)?;
    sync_parent(path)?;
    Ok(())
}

fn open_archive(path: &Path) -> Result<ZipArchive<File>, SourcePackageError> {
    validate_shift_extension(path)?;

    if !path.exists() {
        return Err(SourcePackageError::MissingPackage(path.to_path_buf()));
    }

    if !path.is_file() {
        return Err(SourcePackageError::NotAFile(path.to_path_buf()));
    }

    Ok(ZipArchive::new(File::open(path)?)?)
}

fn validate_archive_manifest<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<(), SourcePackageError> {
    if archive.is_empty() {
        return Err(SourcePackageError::MissingEntry(MANIFEST_FILE.to_string()));
    }

    let mut manifest_file = archive.by_index(0)?;
    if manifest_file.name() != MANIFEST_FILE {
        return Err(SourcePackageError::ManifestNotFirst);
    }

    if manifest_file.compression() != CompressionMethod::Stored {
        return Err(SourcePackageError::ManifestCompressed);
    }

    let mut bytes = Vec::new();
    manifest_file.read_to_end(&mut bytes)?;
    let manifest: ManifestDoc = from_json(MANIFEST_FILE, &bytes)?;
    validate_manifest(&manifest)
}

fn validate_manifest(manifest: &ManifestDoc) -> Result<(), SourcePackageError> {
    if manifest.format != FORMAT_ID {
        return Err(SourcePackageError::UnsupportedFormat(
            manifest.format.clone(),
        ));
    }

    if manifest.schema_version != SCHEMA_VERSION {
        return Err(SourcePackageError::UnsupportedSchemaVersion(
            manifest.schema_version,
        ));
    }

    Ok(())
}

fn validate_glyph_path_id(path: &str, id: &str) -> Result<(), SourcePackageError> {
    let expected_path = format!("{GLYPHS_DIR}/glyph_{id}.json");
    if path == expected_path {
        Ok(())
    } else {
        Err(SourcePackageError::MismatchedGlyphFileId {
            path: path.to_string(),
            id: id.to_string(),
        })
    }
}

fn tmp_path_for(path: &Path) -> PathBuf {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("{name}.tmp"))
        .unwrap_or_else(|| "shift-source.tmp".to_string());
    path.with_file_name(filename)
}

fn sync_parent(path: &Path) -> Result<(), SourcePackageError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn validate_shift_extension(path: &Path) -> Result<(), SourcePackageError> {
    if ShiftSourcePackage::is_package_path(path) {
        Ok(())
    } else {
        Err(SourcePackageError::InvalidExtension(path.to_path_buf()))
    }
}

fn json_entry<T: Serialize>(
    path: &str,
    value: &T,
) -> Result<(String, Vec<u8>), SourcePackageError> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|source| SourcePackageError::Json {
            path: path.to_string(),
            source,
        })?;
    bytes.push(b'\n');
    Ok((path.to_string(), bytes))
}

fn take_json<T: for<'de> Deserialize<'de>>(
    entries: &mut HashMap<String, Vec<u8>>,
    path: &str,
) -> Result<T, SourcePackageError> {
    let bytes = entries
        .remove(path)
        .ok_or_else(|| SourcePackageError::MissingEntry(path.to_string()))?;
    from_json(path, &bytes)
}

fn take_optional_json<T: for<'de> Deserialize<'de>>(
    entries: &mut HashMap<String, Vec<u8>>,
    path: &str,
) -> Result<Option<T>, SourcePackageError> {
    entries
        .remove(path)
        .map(|bytes| from_json(path, &bytes))
        .transpose()
}

fn take_optional_text(
    entries: &mut HashMap<String, Vec<u8>>,
    path: &str,
) -> Result<Option<String>, SourcePackageError> {
    entries
        .remove(path)
        .map(|bytes| {
            String::from_utf8(bytes).map_err(|source| SourcePackageError::Text {
                path: path.to_string(),
                source,
            })
        })
        .transpose()
}

fn from_json<T: for<'de> Deserialize<'de>>(
    path: &str,
    bytes: &[u8],
) -> Result<T, SourcePackageError> {
    serde_json::from_slice(bytes).map_err(|source| SourcePackageError::Json {
        path: path.to_string(),
        source,
    })
}

fn parse_id<T>(kind: &'static str, value: &str) -> Result<T, SourcePackageError>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    value
        .parse()
        .map_err(|error: T::Err| SourcePackageError::InvalidId {
            kind,
            value: value.to_string(),
            message: error.to_string(),
        })
}

fn unicode_to_hex(unicode: u32) -> String {
    format!("{unicode:04X}")
}

fn unicode_from_hex(value: &str) -> Result<u32, SourcePackageError> {
    u32::from_str_radix(value, 16)
        .ok()
        .filter(|unicode| char::from_u32(*unicode).is_some())
        .ok_or_else(|| SourcePackageError::InvalidUnicode(value.to_string()))
}

fn point_type_name(point_type: PointType) -> &'static str {
    match point_type {
        PointType::OnCurve => "onCurve",
        PointType::OffCurve => "offCurve",
        PointType::QCurve => "qCurve",
    }
}

fn kerning_has_data(kerning: &KerningData) -> bool {
    !kerning.pairs().is_empty() || !kerning.groups1().is_empty() || !kerning.groups2().is_empty()
}

fn features_entry(features: &FeatureData) -> Option<(String, Vec<u8>)> {
    features
        .fea_source()
        .map(|source| (FEATURES_FILE.to_string(), source.as_bytes().to_vec()))
}

fn validate_lib_module(module_doc: &LibModuleDoc) -> Result<(), SourcePackageError> {
    if module_doc.owner != LIB_MODULE_OWNER {
        return Err(SourcePackageError::InvalidModule {
            path: LIB_MODULE_FILE.to_string(),
            message: format!("expected owner {LIB_MODULE_OWNER:?}"),
        });
    }

    if module_doc.module != LIB_MODULE_NAME {
        return Err(SourcePackageError::InvalidModule {
            path: LIB_MODULE_FILE.to_string(),
            message: format!("expected module {LIB_MODULE_NAME:?}"),
        });
    }

    if module_doc.schema_version != LIB_MODULE_SCHEMA_VERSION {
        return Err(SourcePackageError::InvalidModule {
            path: LIB_MODULE_FILE.to_string(),
            message: format!("unsupported schema version {}", module_doc.schema_version),
        });
    }

    Ok(())
}

fn apply_lib_module_to_glyph(
    glyph: &mut Glyph,
    module_doc: &mut LibModuleDoc,
) -> Result<(), SourcePackageError> {
    let glyph_id = glyph.id().to_string();

    if let Some(glyph_doc) = module_doc.glyphs.remove(&glyph_id) {
        if glyph_doc.name != glyph.name() {
            return Err(SourcePackageError::InvalidModule {
                path: LIB_MODULE_FILE.to_string(),
                message: format!(
                    "glyph lib name cache {:?} does not match glyph {:?}",
                    glyph_doc.name,
                    glyph.name()
                ),
            });
        }
        *glyph.lib_mut() = lib_from_doc(glyph_doc.lib)?;
    }

    let layer_ids = glyph.layers().keys().cloned().collect::<Vec<_>>();
    for layer_id in layer_ids {
        let Some(layer_doc) = module_doc.layers.remove(&layer_id.to_string()) else {
            continue;
        };

        if layer_doc.glyph_id != glyph_id {
            return Err(SourcePackageError::InvalidModule {
                path: LIB_MODULE_FILE.to_string(),
                message: format!(
                    "layer lib owner {:?} does not match glyph {:?}",
                    layer_doc.glyph_id, glyph_id
                ),
            });
        }

        if layer_doc.glyph_name != glyph.name() {
            return Err(SourcePackageError::InvalidModule {
                path: LIB_MODULE_FILE.to_string(),
                message: format!(
                    "layer lib glyph name cache {:?} does not match glyph {:?}",
                    layer_doc.glyph_name,
                    glyph.name()
                ),
            });
        }

        let layer = glyph.layer_mut(layer_id.clone()).ok_or_else(|| {
            SourcePackageError::DanglingReference {
                field: "lib layer",
                id: layer_id.to_string(),
            }
        })?;

        if layer_doc.source_id != layer.source_id().to_string() {
            return Err(SourcePackageError::InvalidModule {
                path: LIB_MODULE_FILE.to_string(),
                message: format!(
                    "layer lib source {:?} does not match layer source {:?}",
                    layer_doc.source_id,
                    layer.source_id()
                ),
            });
        }

        *layer.lib_mut() = lib_from_doc(layer_doc.lib)?;
    }

    Ok(())
}

fn ensure_lib_module_consumed(module_doc: LibModuleDoc) -> Result<(), SourcePackageError> {
    if let Some(glyph_id) = module_doc.glyphs.keys().next() {
        return Err(SourcePackageError::DanglingReference {
            field: "lib glyph",
            id: glyph_id.clone(),
        });
    }

    if let Some(layer_id) = module_doc.layers.keys().next() {
        return Err(SourcePackageError::DanglingReference {
            field: "lib layer",
            id: layer_id.clone(),
        });
    }

    Ok(())
}

fn lib_to_doc(lib: &LibData) -> BTreeMap<String, LibValueDoc> {
    lib.iter()
        .map(|(key, value)| (key.clone(), LibValueDoc::from(value)))
        .collect()
}

fn lib_from_doc(doc: BTreeMap<String, LibValueDoc>) -> Result<LibData, SourcePackageError> {
    Ok(LibData::from_map(
        doc.into_iter()
            .map(|(key, value)| value.try_into().map(|value| (key, value)))
            .collect::<Result<HashMap<_, _>, _>>()?,
    ))
}

impl LibModuleDoc {
    fn from_font(font: &Font) -> Option<Self> {
        let font_lib = lib_to_doc(font.lib());
        let mut glyphs = BTreeMap::new();
        let mut layers = BTreeMap::new();

        for glyph in font.glyphs() {
            if !glyph.lib().is_empty() {
                glyphs.insert(
                    glyph.id().to_string(),
                    GlyphLibDoc {
                        name: glyph.name().to_string(),
                        lib: lib_to_doc(glyph.lib()),
                    },
                );
            }

            for layer in glyph.layers().values() {
                if layer.lib().is_empty() {
                    continue;
                }

                layers.insert(
                    layer.id().to_string(),
                    LayerLibDoc {
                        glyph_id: glyph.id().to_string(),
                        glyph_name: glyph.name().to_string(),
                        source_id: layer.source_id().to_string(),
                        lib: lib_to_doc(layer.lib()),
                    },
                );
            }
        }

        if font_lib.is_empty() && glyphs.is_empty() && layers.is_empty() {
            return None;
        }

        Some(Self {
            owner: LIB_MODULE_OWNER.to_string(),
            module: LIB_MODULE_NAME.to_string(),
            schema_version: LIB_MODULE_SCHEMA_VERSION,
            font: font_lib,
            glyphs,
            layers,
        })
    }
}

impl From<&LibValue> for LibValueDoc {
    fn from(value: &LibValue) -> Self {
        match value {
            LibValue::String(value) => Self::String(value.clone()),
            LibValue::Integer(value) => Self::Integer(*value),
            LibValue::Float(value) => Self::Float(*value),
            LibValue::Boolean(value) => Self::Boolean(*value),
            LibValue::Array(values) => Self::Array(values.iter().map(Self::from).collect()),
            LibValue::Dict(values) => Self::Dict(
                values
                    .iter()
                    .map(|(key, value)| (key.clone(), Self::from(value)))
                    .collect(),
            ),
            LibValue::Data(value) => Self::Data(value.clone()),
        }
    }
}

impl TryFrom<LibValueDoc> for LibValue {
    type Error = SourcePackageError;

    fn try_from(doc: LibValueDoc) -> Result<Self, Self::Error> {
        Ok(match doc {
            LibValueDoc::String(value) => Self::String(value),
            LibValueDoc::Integer(value) => Self::Integer(value),
            LibValueDoc::Float(value) => Self::Float(value),
            LibValueDoc::Boolean(value) => Self::Boolean(value),
            LibValueDoc::Array(values) => Self::Array(
                values
                    .into_iter()
                    .map(Self::try_from)
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            LibValueDoc::Dict(values) => Self::Dict(
                values
                    .into_iter()
                    .map(|(key, value)| value.try_into().map(|value| (key, value)))
                    .collect::<Result<HashMap<_, _>, _>>()?,
            ),
            LibValueDoc::Data(value) => Self::Data(value),
        })
    }
}

impl KerningDoc {
    fn from_font(font: &Font) -> Result<Self, SourcePackageError> {
        let mut groups1 = BTreeMap::new();
        for (group_id, members) in font.kerning().groups1() {
            groups1.insert(
                group_id.clone(),
                members
                    .iter()
                    .map(|name| glyph_ref_for_name(font, "kerning.groups1", name))
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }

        let mut groups2 = BTreeMap::new();
        for (group_id, members) in font.kerning().groups2() {
            groups2.insert(
                group_id.clone(),
                members
                    .iter()
                    .map(|name| glyph_ref_for_name(font, "kerning.groups2", name))
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }

        let pairs = font
            .kerning()
            .pairs()
            .iter()
            .map(|pair| KerningPairDoc::from_pair(font, pair))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            schema_version: KERNING_SCHEMA_VERSION,
            pairs,
            groups1,
            groups2,
        })
    }
}

impl KerningPairDoc {
    fn from_pair(font: &Font, pair: &KerningPair) -> Result<Self, SourcePackageError> {
        Ok(Self {
            first: KerningSideDoc::from_side(font, &pair.first, "kerning.pairs.first")?,
            second: KerningSideDoc::from_side(font, &pair.second, "kerning.pairs.second")?,
            value: pair.value,
        })
    }
}

impl KerningSideDoc {
    fn from_side(
        font: &Font,
        side: &KerningSide,
        field: &'static str,
    ) -> Result<Self, SourcePackageError> {
        Ok(match side {
            KerningSide::Glyph(name) => {
                let glyph_ref = glyph_ref_for_name(font, field, name)?;
                Self::Glyph {
                    glyph_id: glyph_ref.glyph_id,
                    name: glyph_ref.name,
                }
            }
            KerningSide::Group(group_id) => Self::Group {
                group_id: group_id.clone(),
            },
        })
    }

    fn into_side(
        self,
        names_by_id: &HashMap<String, GlyphName>,
        field: &'static str,
    ) -> Result<KerningSide, SourcePackageError> {
        Ok(match self {
            Self::Glyph { glyph_id, name } => {
                KerningSide::Glyph(glyph_name_from_ref(glyph_id, name, names_by_id, field)?)
            }
            Self::Group { group_id } => KerningSide::Group(group_id),
        })
    }
}

fn kerning_from_doc(doc: KerningDoc, font: &Font) -> Result<KerningData, SourcePackageError> {
    if doc.schema_version != KERNING_SCHEMA_VERSION {
        return Err(SourcePackageError::UnsupportedSchemaVersion(
            doc.schema_version,
        ));
    }

    let names_by_id = glyph_names_by_id(font);
    let mut kerning = KerningData::new();

    for (group_id, members) in doc.groups1 {
        kerning.set_group1(
            group_id,
            members
                .into_iter()
                .map(|glyph_ref| glyph_ref.into_name(&names_by_id, "kerning.groups1"))
                .collect::<Result<Vec<_>, _>>()?,
        );
    }

    for (group_id, members) in doc.groups2 {
        kerning.set_group2(
            group_id,
            members
                .into_iter()
                .map(|glyph_ref| glyph_ref.into_name(&names_by_id, "kerning.groups2"))
                .collect::<Result<Vec<_>, _>>()?,
        );
    }

    for pair_doc in doc.pairs {
        kerning.add_pair(KerningPair::new(
            pair_doc
                .first
                .into_side(&names_by_id, "kerning.pairs.first")?,
            pair_doc
                .second
                .into_side(&names_by_id, "kerning.pairs.second")?,
            pair_doc.value,
        ));
    }

    Ok(kerning)
}

impl GlyphRefDoc {
    fn into_name(
        self,
        names_by_id: &HashMap<String, GlyphName>,
        field: &'static str,
    ) -> Result<GlyphName, SourcePackageError> {
        glyph_name_from_ref(self.glyph_id, self.name, names_by_id, field)
    }
}

fn glyph_ref_for_name(
    font: &Font,
    field: &'static str,
    name: &GlyphName,
) -> Result<GlyphRefDoc, SourcePackageError> {
    let glyph_id = font.glyph_id_by_name(name.as_str()).ok_or_else(|| {
        SourcePackageError::UnresolvedGlyphName {
            field,
            name: name.to_string(),
        }
    })?;

    Ok(GlyphRefDoc {
        glyph_id: glyph_id.to_string(),
        name: name.to_string(),
    })
}

fn glyph_names_by_id(font: &Font) -> HashMap<String, GlyphName> {
    font.glyphs()
        .map(|glyph| (glyph.id().to_string(), glyph.glyph_name().clone()))
        .collect()
}

fn glyph_name_from_ref(
    glyph_id: String,
    name: String,
    names_by_id: &HashMap<String, GlyphName>,
    field: &'static str,
) -> Result<GlyphName, SourcePackageError> {
    let glyph_name =
        names_by_id
            .get(&glyph_id)
            .ok_or_else(|| SourcePackageError::DanglingReference {
                field,
                id: glyph_id.clone(),
            })?;

    if glyph_name.as_str() != name {
        return Err(SourcePackageError::InvalidId {
            kind: "glyphNameCache",
            value: name,
            message: format!("expected current name {:?}", glyph_name.as_str()),
        });
    }

    Ok(glyph_name.clone())
}

impl From<&Guideline> for GuidelineDoc {
    fn from(guideline: &Guideline) -> Self {
        Self {
            id: guideline.id().to_string(),
            x: guideline.x(),
            y: guideline.y(),
            angle: guideline.angle(),
            name: guideline.name().map(str::to_string),
            color: guideline.color().map(str::to_string),
        }
    }
}

impl TryFrom<GuidelineDoc> for Guideline {
    type Error = SourcePackageError;

    fn try_from(doc: GuidelineDoc) -> Result<Self, Self::Error> {
        Ok(Self::with_id(
            parse_id("guideline", &doc.id)?,
            doc.x,
            doc.y,
            doc.angle,
            doc.name,
            doc.color,
        ))
    }
}

impl From<&FontMetadata> for MetadataDoc {
    fn from(metadata: &FontMetadata) -> Self {
        Self {
            family_name: metadata.family_name.clone(),
            style_name: metadata.style_name.clone(),
            version_major: metadata.version_major,
            version_minor: metadata.version_minor,
            copyright: metadata.copyright.clone(),
            trademark: metadata.trademark.clone(),
            designer: metadata.designer.clone(),
            designer_url: metadata.designer_url.clone(),
            manufacturer: metadata.manufacturer.clone(),
            manufacturer_url: metadata.manufacturer_url.clone(),
            license: metadata.license.clone(),
            license_url: metadata.license_url.clone(),
            description: metadata.description.clone(),
            note: metadata.note.clone(),
        }
    }
}

impl From<MetadataDoc> for FontMetadata {
    fn from(doc: MetadataDoc) -> Self {
        Self {
            family_name: doc.family_name,
            style_name: doc.style_name,
            version_major: doc.version_major,
            version_minor: doc.version_minor,
            copyright: doc.copyright,
            trademark: doc.trademark,
            designer: doc.designer,
            designer_url: doc.designer_url,
            manufacturer: doc.manufacturer,
            manufacturer_url: doc.manufacturer_url,
            license: doc.license,
            license_url: doc.license_url,
            description: doc.description,
            note: doc.note,
        }
    }
}

impl From<FontMetrics> for MetricsDoc {
    fn from(metrics: FontMetrics) -> Self {
        Self {
            units_per_em: metrics.units_per_em,
            ascender: metrics.ascender,
            descender: metrics.descender,
            cap_height: metrics.cap_height,
            x_height: metrics.x_height,
            line_gap: metrics.line_gap,
            italic_angle: metrics.italic_angle,
            underline_position: metrics.underline_position,
            underline_thickness: metrics.underline_thickness,
        }
    }
}

impl From<MetricsDoc> for FontMetrics {
    fn from(doc: MetricsDoc) -> Self {
        Self {
            units_per_em: doc.units_per_em,
            ascender: doc.ascender,
            descender: doc.descender,
            cap_height: doc.cap_height,
            x_height: doc.x_height,
            line_gap: doc.line_gap,
            italic_angle: doc.italic_angle,
            underline_position: doc.underline_position,
            underline_thickness: doc.underline_thickness,
        }
    }
}

impl From<&Axis> for AxisDoc {
    fn from(axis: &Axis) -> Self {
        Self {
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum: axis.minimum(),
            default: axis.default(),
            maximum: axis.maximum(),
            hidden: axis.is_hidden(),
        }
    }
}

impl From<AxisDoc> for Axis {
    fn from(doc: AxisDoc) -> Self {
        let mut axis = Axis::new(doc.tag, doc.name, doc.minimum, doc.default, doc.maximum);
        axis.set_hidden(doc.hidden);
        axis
    }
}

impl From<&Source> for SourceDoc {
    fn from(source: &Source) -> Self {
        Self {
            id: source.id().to_string(),
            name: source.name().to_string(),
            location: source
                .location()
                .iter()
                .map(|(tag, value)| (tag.clone(), *value))
                .collect(),
            filename: source.filename().map(str::to_string),
        }
    }
}

impl TryFrom<SourceDoc> for Source {
    type Error = SourcePackageError;

    fn try_from(doc: SourceDoc) -> Result<Self, Self::Error> {
        Ok(Self::with_id(
            parse_id("source", &doc.id)?,
            doc.name,
            Location::from_map(doc.location.into_iter().collect()),
            doc.filename,
        ))
    }
}

impl From<&Glyph> for GlyphDoc {
    fn from(glyph: &Glyph) -> Self {
        let mut layers = BTreeMap::new();
        for layer in glyph.layers().values() {
            layers.insert(
                layer.source_id().to_string(),
                LayerDoc::from(layer.as_ref()),
            );
        }

        Self {
            id: glyph.id().to_string(),
            name: glyph.name().to_string(),
            unicodes: glyph
                .unicodes()
                .iter()
                .map(|u| unicode_to_hex(*u))
                .collect(),
            layers,
        }
    }
}

impl TryFrom<GlyphDoc> for Glyph {
    type Error = SourcePackageError;

    fn try_from(doc: GlyphDoc) -> Result<Self, Self::Error> {
        let glyph_name = GlyphName::new(doc.name.clone())
            .map_err(|_| SourcePackageError::InvalidGlyphName(doc.name.clone()))?;
        let mut glyph = Glyph::with_id(parse_id("glyph", &doc.id)?, glyph_name);
        glyph.set_unicodes(
            doc.unicodes
                .iter()
                .map(|value| unicode_from_hex(value))
                .collect::<Result<Vec<_>, _>>()?,
        );

        for (source_id, layer_doc) in doc.layers {
            glyph.set_layer(layer_doc.into_layer(parse_id("source", &source_id)?)?);
        }

        Ok(glyph)
    }
}

impl From<&GlyphLayer> for LayerDoc {
    fn from(layer: &GlyphLayer) -> Self {
        Self {
            id: layer.id().to_string(),
            advance: layer.width(),
            height: layer.height(),
            contours: layer.contours_iter().map(ContourDoc::from).collect(),
            components: layer
                .components()
                .iter()
                .map(|(id, component)| (id.to_string(), ComponentDoc::from(component)))
                .collect(),
            anchors: layer.anchors_iter().map(AnchorDoc::from).collect(),
            guidelines: layer.guidelines().iter().map(GuidelineDoc::from).collect(),
        }
    }
}

impl LayerDoc {
    fn into_layer(self, source_id: SourceId) -> Result<GlyphLayer, SourcePackageError> {
        let mut layer =
            GlyphLayer::with_width(parse_id("layer", &self.id)?, source_id, self.advance);
        layer.set_height(self.height);

        for contour_doc in self.contours {
            layer.add_contour(Contour::try_from(contour_doc)?);
        }

        for (component_id, component_doc) in self.components {
            layer.add_component(
                component_doc.into_component(parse_id("component", &component_id)?)?,
            );
        }

        for anchor_doc in self.anchors {
            layer.add_anchor(Anchor::try_from(anchor_doc)?);
        }

        for guideline_doc in self.guidelines {
            layer.add_guideline(Guideline::try_from(guideline_doc)?);
        }

        Ok(layer)
    }
}

impl From<&Contour> for ContourDoc {
    fn from(contour: &Contour) -> Self {
        Self {
            id: contour.id().to_string(),
            closed: contour.is_closed(),
            points: contour.points().iter().map(PointDoc::from).collect(),
        }
    }
}

impl TryFrom<ContourDoc> for Contour {
    type Error = SourcePackageError;

    fn try_from(doc: ContourDoc) -> Result<Self, Self::Error> {
        let mut contour = Contour::with_id(parse_id("contour", &doc.id)?);
        if doc.closed {
            contour.close();
        }

        for point_doc in doc.points {
            contour.push_point(Point::try_from(point_doc)?);
        }

        Ok(contour)
    }
}

impl From<&Point> for PointDoc {
    fn from(point: &Point) -> Self {
        Self {
            id: point.id().to_string(),
            x: point.x(),
            y: point.y(),
            point_type: point_type_name(point.point_type()).to_string(),
            smooth: point.is_smooth(),
        }
    }
}

impl TryFrom<PointDoc> for Point {
    type Error = SourcePackageError;

    fn try_from(doc: PointDoc) -> Result<Self, Self::Error> {
        Ok(Point::new(
            parse_id("point", &doc.id)?,
            doc.x,
            doc.y,
            doc.point_type
                .parse()
                .map_err(|message| SourcePackageError::InvalidId {
                    kind: "pointType",
                    value: doc.point_type.clone(),
                    message,
                })?,
            doc.smooth,
        ))
    }
}

impl From<&Component> for ComponentDoc {
    fn from(component: &Component) -> Self {
        Self {
            base_glyph: component.base_glyph().as_str().to_string(),
            transform: TransformDoc::from(*component.transform()),
        }
    }
}

impl ComponentDoc {
    fn into_component(self, id: ComponentId) -> Result<Component, SourcePackageError> {
        let base_glyph = GlyphName::new(self.base_glyph.clone())
            .map_err(|_| SourcePackageError::InvalidGlyphName(self.base_glyph.clone()))?;
        Ok(Component::with_id(id, base_glyph, self.transform.into()))
    }
}

impl From<DecomposedTransform> for TransformDoc {
    fn from(transform: DecomposedTransform) -> Self {
        Self {
            translate_x: transform.translate_x,
            translate_y: transform.translate_y,
            rotation: transform.rotation,
            scale_x: transform.scale_x,
            scale_y: transform.scale_y,
            skew_x: transform.skew_x,
            skew_y: transform.skew_y,
            t_center_x: transform.t_center_x,
            t_center_y: transform.t_center_y,
        }
    }
}

impl From<TransformDoc> for DecomposedTransform {
    fn from(doc: TransformDoc) -> Self {
        Self {
            translate_x: doc.translate_x,
            translate_y: doc.translate_y,
            rotation: doc.rotation,
            scale_x: doc.scale_x,
            scale_y: doc.scale_y,
            skew_x: doc.skew_x,
            skew_y: doc.skew_y,
            t_center_x: doc.t_center_x,
            t_center_y: doc.t_center_y,
        }
    }
}

impl From<&Anchor> for AnchorDoc {
    fn from(anchor: &Anchor) -> Self {
        Self {
            id: anchor.id().to_string(),
            name: anchor.name().map(str::to_string),
            x: anchor.x(),
            y: anchor.y(),
        }
    }
}

impl TryFrom<AnchorDoc> for Anchor {
    type Error = SourcePackageError;

    fn try_from(doc: AnchorDoc) -> Result<Self, Self::Error> {
        Ok(Anchor::with_id(
            parse_id("anchor", &doc.id)?,
            doc.name,
            doc.x,
            doc.y,
        ))
    }
}
